import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, request } from 'undici';
import { PKError } from './types.js';
import { MAX_SOURCE_BYTES } from './library.js';
/** Deliberately conservative: special-purpose and transition ranges are not public imports. */
export function isPublicAddress(ip) {
    if (isIP(ip) === 4) {
        const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
            (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
    }
    if (isIP(ip) === 6) {
        const lower = ip.toLowerCase();
        const first = Number.parseInt(lower.split(':')[0] || '0', 16);
        if (first < 0x2000 || first > 0x3fff || lower.includes('.'))
            return false;
        // IPv6 protocol assignments, benchmarking/documentation, Teredo and 6to4.
        const second = Number.parseInt(lower.split(':')[1] || '0', 16);
        if (first === 0x2001 && (second < 0x200 || second === 0xdb8) || first === 0x2002 || first === 0x3fff)
            return false;
        return true;
    }
    return false;
}
export function validatePublicUrl(value) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new PKError('UNSAFE_URL', 'Expected an absolute public HTTP(S) URL');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && url.port !== '80' && url.port !== '443'))
        throw new PKError('UNSAFE_URL', 'Only public HTTP(S) URLs on standard ports without credentials are allowed');
    const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (!hostname || hostname === 'localhost' || !hostname.includes('.') && !isIP(hostname) || /\.(?:localhost|local|internal|test|invalid|example|onion)$/.test(hostname) || hostname.endsWith('.home.arpa') || (isIP(hostname) && !isPublicAddress(hostname)))
        throw new PKError('UNSAFE_URL', 'Local and special-purpose hosts cannot be fetched');
    url.hash = '';
    return url;
}
export function createSafeFetcher(dependencies = {}) {
    const sendRequest = dependencies.request ?? request;
    const resolveHost = dependencies.lookup ?? (async (host) => dnsLookup(host, { all: true, verbatim: true }));
    return async (value, options = {}) => {
        const maxBytes = options.maxBytes ?? MAX_SOURCE_BYTES;
        const timeoutMs = options.timeoutMs ?? 30_000;
        const maxRedirects = options.maxRedirects ?? 3;
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_SOURCE_BYTES || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000 || !Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 5)
            throw new PKError('INVALID_INPUT', 'Invalid fetch limits');
        const signal = AbortSignal.timeout(timeoutMs);
        let url = validatePublicUrl(value);
        for (let redirects = 0; redirects <= maxRedirects; redirects++) {
            if (signal.aborted)
                throw new PKError('FETCH_TIMEOUT', 'Source request timed out');
            const host = url.hostname.replace(/^\[|\]$/g, '');
            const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
                resolveHost(host),
                new Promise((_, reject) => signal.addEventListener('abort', () => reject(new PKError('FETCH_TIMEOUT', 'DNS resolution exceeded request time limit')), { once: true })),
            ]);
            if (!addresses.length || addresses.some(item => !isPublicAddress(item.address)))
                throw new PKError('UNSAFE_URL', 'DNS returned a local or special-purpose address');
            const pinned = addresses[0];
            // Connection DNS is pinned to the checked answer, preserving URL hostname for TLS/SNI.
            const dispatcher = new Agent({ connect: { lookup: (_hostname, opts, callback) => {
                        if (opts.all)
                            callback(null, [{ address: pinned.address, family: pinned.family }]);
                        else
                            callback(null, pinned.address, pinned.family);
                    } } });
            try {
                const response = await sendRequest(url, { dispatcher, signal, method: 'GET', headers: { 'accept-encoding': 'identity', 'user-agent': 'Plot-and-Kin/0.1 (+local researcher document import)' }, headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
                if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                    const location = response.headers.location;
                    response.body.on('error', () => undefined);
                    response.body.destroy();
                    if (typeof location !== 'string' || redirects === maxRedirects)
                        throw new PKError('FETCH_REDIRECT', 'Redirect missing its destination or exceeded limit');
                    const target = validatePublicUrl(new URL(location, url).href);
                    if (url.protocol === 'https:' && target.protocol !== 'https:')
                        throw new PKError('UNSAFE_URL', 'HTTPS redirects cannot downgrade to HTTP');
                    url = target;
                    continue;
                }
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    response.body.on('error', () => undefined);
                    response.body.destroy();
                    throw new PKError('FETCH_HTTP_ERROR', `Remote source returned HTTP ${response.statusCode}`);
                }
                const length = Number(response.headers['content-length']);
                if (Number.isFinite(length) && length > maxBytes) {
                    response.body.on('error', () => undefined);
                    response.body.destroy();
                    throw new PKError('FILE_TOO_LARGE', 'Remote document exceeds its byte limit');
                }
                const encoding = response.headers['content-encoding'];
                if (encoding && encoding !== 'identity') {
                    response.body.on('error', () => undefined);
                    response.body.destroy();
                    throw new PKError('FETCH_ENCODING', 'Unexpected compressed transfer encoding');
                }
                const chunks = [];
                let size = 0;
                for await (const chunk of response.body) {
                    const bytes = Buffer.from(chunk);
                    size += bytes.byteLength;
                    if (size > maxBytes) {
                        response.body.on('error', () => undefined);
                        response.body.destroy();
                        throw new PKError('FILE_TOO_LARGE', 'Remote document exceeds its byte limit');
                    }
                    chunks.push(bytes);
                }
                return { bytes: Buffer.concat(chunks), contentType: String(response.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim().toLowerCase(), url: url.href, status: response.statusCode };
            }
            catch (error) {
                if (error instanceof PKError)
                    throw error;
                throw new PKError(signal.aborted ? 'FETCH_TIMEOUT' : 'FETCH_FAILED', signal.aborted ? 'Source request timed out' : 'Unable to retrieve the public source');
            }
            finally {
                await dispatcher.close();
            }
        }
        throw new PKError('FETCH_REDIRECT', 'Redirect limit exceeded');
    };
}
export const safeFetch = createSafeFetcher();
//# sourceMappingURL=network.js.map