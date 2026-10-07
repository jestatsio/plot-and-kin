import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'smol-toml';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Application } from './application.js';
import { readConfig } from './config.js';
import { OperatingSystemVault, readPrivateFile, readSettings, saveSettings, settingsDirectory, writePrivateFile } from './settings.js';
import { PKError } from './types.js';
import { createProvider } from './providers.js';
import { presetEnvironment, PROCESSING_PRESETS } from './processing-presets.js';
export function parseSetupOptions(args, env = process.env) {
    const result = { nonInteractive: false, connectAstra: false, processing: false, home: homedir(), settingsDir: settingsDirectory(env) };
    let customSettings = Boolean(env.PK_SETTINGS_DIR);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--non-interactive') {
            result.nonInteractive = true;
            continue;
        }
        if (arg === '--connect-astra') {
            result.connectAstra = true;
            continue;
        }
        if (arg === '--processing') {
            result.processing = true;
            continue;
        }
        const value = args[++i];
        if (!value || value.startsWith('--'))
            throw new PKError('USAGE', `A value is required after ${arg}.`);
        if (arg === '--client' && ['codex', 'claude', 'both', 'none'].includes(value))
            result.client = value;
        else if (arg === '--storage' && ['local', 'astra'].includes(value))
            result.storage = value;
        else if (arg === '--preset' && ['openai', 'anthropic', 'custom'].includes(value)) {
            result.preset = value;
            result.processing = true;
        }
        else if (arg === '--home')
            result.home = resolve(value);
        else if (arg === '--settings-dir') {
            result.settingsDir = resolve(value);
            customSettings = true;
        }
        else if (arg === '--library-dir')
            result.libraryDir = resolve(value);
        else if (arg === '--codex-config')
            result.codexConfig = resolve(value);
        else if (arg === '--claude-config')
            result.claudeConfig = resolve(value);
        else
            throw new PKError('USAGE', `Unknown setup option or invalid value: ${arg}. Tokens and API keys must never be command arguments.`);
    }
    if (!customSettings)
        result.settingsDir = join(result.home, '.plot-and-kin', 'settings');
    if (result.nonInteractive && !result.client)
        throw new PKError('USAGE', 'Choose --client codex, claude, both, or none for non-interactive setup.');
    return result;
}
export function clientConfigPaths(home, platform = process.platform, env = process.env) {
    const actualHome = resolve(home) === resolve(homedir());
    return {
        codex: join(actualHome && env.CODEX_HOME ? env.CODEX_HOME : join(home, '.codex'), 'config.toml'),
        claude: platform === 'win32' ? join(actualHome && env.APPDATA ? env.APPDATA : join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json') : join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    };
}
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
async function guardLegacyRegistration(client, path) {
    const previous = await readPrivateFile(path);
    if (previous === undefined)
        return;
    let config;
    try {
        config = client === 'codex' ? parse(previous) : JSON.parse(previous);
    }
    catch {
        throw new PKError('CLIENT_CONFIG', 'Existing client settings could not be parsed safely. Repair that file before running setup. No configuration has been changed.');
    }
    const servers = plainObject(config) ? config[client === 'codex' ? 'mcp_servers' : 'mcpServers'] : undefined;
    const registration = plainObject(servers) ? servers['plot-and-kin'] : undefined;
    const environment = plainObject(registration) ? registration.env : undefined;
    if (plainObject(environment) && ['PK_STORAGE', 'PK_LIBRARY_DIR', 'PK_IMPORT_DIR', 'PK_SETTINGS_DIR', 'ASTRA_DB_API_ENDPOINT', 'ASTRA_DB_APPLICATION_TOKEN', 'ASTRA_DB_KEYSPACE'].some(key => environment[key] !== undefined)) {
        throw new PKError('LEGACY_SETUP', 'Your existing Plot & Kin connection has research storage settings that must be preserved. First run setup --client none --library-dir <existing-library>, adding --storage astra for existing Astra research, and enter credentials securely when prompted. Then run setup again to reconnect your clients. No settings or client configuration have been changed.');
    }
}
/** Official stdio registration uses argument arrays. No shell expansion and no secret environment entries. */
export async function registerClient(client, path, settingsDir, command = process.execPath, entryPoint = fileURLToPath(new URL('./cli.js', import.meta.url))) {
    const previous = await readPrivateFile(path);
    const registration = { command, args: [resolve(entryPoint), 'serve'], env: { PK_SETTINGS_DIR: resolve(settingsDir) } };
    let content;
    try {
        if (client === 'codex') {
            const config = previous === undefined ? {} : parse(previous);
            if (config.mcp_servers !== undefined && !plainObject(config.mcp_servers))
                throw new Error('Invalid mcp_servers');
            config.mcp_servers = { ...(config.mcp_servers ?? {}), 'plot-and-kin': registration };
            content = `${stringify(config)}\n`;
        }
        else {
            const config = previous === undefined ? {} : JSON.parse(previous);
            if (!plainObject(config) || (config.mcpServers !== undefined && !plainObject(config.mcpServers)))
                throw new Error('Invalid mcpServers');
            config.mcpServers = { ...(config.mcpServers ?? {}), 'plot-and-kin': registration };
            content = `${JSON.stringify(config, null, 2)}\n`;
        }
    }
    catch {
        throw new PKError('CLIENT_CONFIG', `${client === 'codex' ? 'Codex' : 'Claude Desktop'} settings could not be parsed safely. Existing settings have not been changed. Repair that file or choose another configuration path.`);
    }
    const backup = await writePrivateFile(path, content, previous, true);
    return { client, path, backup, registered: true, connection: 'pending-client-restart' };
}
export async function installCodexSkill(home) {
    const marker = '<!-- Managed by Plot & Kin setup. -->';
    const path = join(home, '.agents', 'skills', 'plot-and-kin', 'SKILL.md');
    const previous = await readPrivateFile(path);
    if (previous !== undefined && !previous.includes(marker))
        throw new PKError('SKILL_CONFLICT', 'An existing plot-and-kin skill is not managed by setup. Rename that skill directory before retrying. Its contents have not been changed.');
    const source = await readPrivateFile(fileURLToPath(new URL('../skills/research-property/SKILL.md', import.meta.url)));
    if (!source)
        throw new PKError('INSTALL_INCOMPLETE', 'The installed release is missing its research workflow. Reinstall the complete release.');
    const content = `${source.replace('name: research-property', 'name: plot-and-kin').trim()}\n\n${marker}\n`;
    return { path, backup: await writePrivateFile(path, content, previous, true) };
}
async function password(prompt) {
    if (!process.stdin.isTTY)
        throw new PKError('SETUP_INPUT', 'Credential entry requires an interactive terminal. Never paste credentials into chat.');
    process.stdout.write(`${prompt}: `);
    return new Promise((resolveValue, reject) => {
        const wasRaw = process.stdin.isRaw;
        let value = '';
        const cleanup = () => { process.stdin.off('data', onData); process.stdin.setRawMode(wasRaw); process.stdin.pause(); process.stdout.write('\n'); };
        const onData = (data) => {
            for (const char of data.toString('utf8')) {
                if (char === '\u0003') {
                    cleanup();
                    reject(new PKError('SETUP_CANCELLED', 'Setup cancelled.'));
                    return;
                }
                if (char === '\r' || char === '\n') {
                    cleanup();
                    resolveValue(value);
                    return;
                }
                if (char === '\u007f' || char === '\b')
                    value = value.slice(0, -1);
                else if (char >= ' ' && value.length < 16_000)
                    value += char;
            }
        };
        process.stdin.setRawMode(true);
        process.stdin.on('data', onData);
        process.stdin.resume();
    });
}
async function question(prompt) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        return (await rl.question(prompt)).trim();
    }
    finally {
        rl.close();
    }
}
async function exists(path) { try {
    await access(path);
    return true;
}
catch {
    return false;
} }
export async function verifyServerConnection(settingsDir) {
    const client = new Client({ name: 'plot-and-kin-setup', version: '0.1.0' });
    let timer;
    try {
        const work = async () => {
            await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./cli.js', import.meta.url)), 'serve'], env: { ...Object.fromEntries(Object.entries(process.env).filter((entry) => entry[1] !== undefined)), PK_SETTINGS_DIR: settingsDir }, stderr: 'pipe' }));
            const { tools } = await client.listTools();
            if (!tools.some(tool => tool.name === 'project_create'))
                throw new PKError('CONNECTION', 'The server connected but did not advertise research tools. Rerun setup from the installed release.');
            const readiness = await client.callTool({ name: 'setup_status', arguments: {} });
            const structured = readiness.structuredContent;
            const result = structured?.result;
            if (readiness.isError || result?.ready !== true)
                throw new PKError('CONNECTION', 'The installed server connected but saved research settings are not ready. Run doctor, check any environment overrides, and retry setup.');
            return { protocol: 'verified', tools: tools.length };
        };
        return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(new PKError('CONNECTION', 'The local server did not respond within 20 seconds. Run doctor and retry setup.')), 20_000); })]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
        await client.close();
    }
}
export async function runSetup(options, dependencies = {}) {
    const env = dependencies.env ?? process.env;
    const ask = dependencies.ask ?? question;
    const secret = dependencies.password ?? password;
    const output = dependencies.output ?? (text => process.stdout.write(`${text}\n`));
    if (!options.nonInteractive && !dependencies.ask && !process.stdin.isTTY)
        throw new PKError('SETUP_INPUT', 'Open an interactive terminal to run setup, or use --non-interactive --client codex|claude|both|none.');
    const previous = await readPrivateFile(join(options.settingsDir, 'settings.json'));
    const saved = await readSettings(options.settingsDir);
    const settings = saved ? { ...saved } : { version: 1, storage: 'local', libraryDir: options.libraryDir ?? join(options.home, '.plot-and-kin') };
    if (options.libraryDir && saved && resolve(options.libraryDir) !== resolve(saved.libraryDir))
        throw new PKError('SETUP_LIBRARY', 'Changing the library would hide existing cases. Keep the current path, or use backup and restore into a separate settings directory.');
    output('Plot & Kin — your evidence, your research.\nPublic records and text documents need no database account or model key.');
    const paths = clientConfigPaths(options.home);
    if (!options.client) {
        const found = (await Promise.all(['codex', 'claude'].map(async (client) => await exists(paths[client]) ? client : undefined))).filter(Boolean);
        output(`Detected configuration: ${found.length ? found.join(', ') : 'none yet'}. You can register a client before its first launch.`);
        const answer = (await ask('Connect [1] Codex, [2] Claude Desktop, [3] both, or [4] none? [3]: ')) || '3';
        options.client = { '1': 'codex', '2': 'claude', '3': 'both', '4': 'none' }[answer];
        if (!options.client)
            throw new PKError('SETUP_INPUT', 'Choose 1, 2, 3, or 4 and run setup again.');
    }
    if (!saved) {
        for (const client of ['codex', 'claude'])
            if (options.client === client || options.client === 'both') {
                await guardLegacyRegistration(client, client === 'codex' ? options.codexConfig ?? paths.codex : options.claudeConfig ?? paths.claude);
            }
    }
    if (!options.storage && !options.nonInteractive && !saved) {
        const choice = (await ask('Save research [1] on this computer (recommended), or [2] in your Astra database? [1]: ')) || '1';
        if (!['1', '2'].includes(choice))
            throw new PKError('SETUP_INPUT', 'Choose 1 or 2 and run setup again.');
        options.storage = choice === '2' ? 'astra' : 'local';
    }
    if (options.storage)
        settings.storage = options.storage;
    const vault = dependencies.vault ?? new OperatingSystemVault(options.settingsDir);
    const credentialEnv = {};
    if (options.connectAstra || (settings.storage === 'astra' && !settings.astra)) {
        output('Astra is optional. Create a serverless database at https://astra.datastax.com and copy its API endpoint and application token.\nOnly pk_records and pk_passages are initialized. Original documents stay on this computer.');
        const endpoint = env.ASTRA_DB_API_ENDPOINT ?? (options.nonInteractive ? undefined : await ask('Astra API endpoint (https://…apps.astra.datastax.com): '));
        const token = env.ASTRA_DB_APPLICATION_TOKEN ?? (options.nonInteractive ? undefined : await secret('Astra application token (hidden)'));
        const keyspace = env.ASTRA_DB_KEYSPACE ?? (options.nonInteractive ? 'default_keyspace' : (await ask('Keyspace [default_keyspace]: ')) || 'default_keyspace');
        if (!endpoint || !token)
            throw new PKError('SETUP_INPUT', 'Astra endpoint and token are required. In non-interactive setup, supply credentials through the environment, never command arguments.');
        readConfig({ PK_STORAGE: 'astra', ASTRA_DB_API_ENDPOINT: endpoint, ASTRA_DB_APPLICATION_TOKEN: token, ASTRA_DB_KEYSPACE: keyspace });
        Object.assign(credentialEnv, { ASTRA_DB_API_ENDPOINT: endpoint, ASTRA_DB_APPLICATION_TOKEN: token, ASTRA_DB_KEYSPACE: keyspace });
        const credentialId = randomUUID();
        await vault.set(credentialId, token);
        settings.astra = { endpoint, keyspace, credentialId };
    }
    else if (settings.astra) {
        Object.assign(credentialEnv, { ASTRA_DB_API_ENDPOINT: settings.astra.endpoint, ASTRA_DB_KEYSPACE: settings.astra.keyspace });
        if (settings.storage === 'astra')
            credentialEnv.ASTRA_DB_APPLICATION_TOKEN = env.ASTRA_DB_APPLICATION_TOKEN ?? await vault.get(settings.astra.credentialId);
    }
    if (options.processing) {
        output('Scan interpretation sends selected document pages to your chosen provider. The project processing limit is $10. Client and database charges are separate.');
        let preset = options.preset;
        if (!preset && !options.nonInteractive) {
            const choice = await ask('Choose scan processing [1] OpenAI GPT-4.1 mini, [2] Anthropic Haiku 4.5, or [3] custom provider settings: ');
            preset = { '1': 'openai', '2': 'anthropic', '3': 'custom' }[choice];
            if (!preset)
                throw new PKError('SETUP_INPUT', 'Choose a provider explicitly. No provider has been selected.');
        }
        let values;
        if (preset && preset !== 'custom') {
            const p = PROCESSING_PRESETS[preset];
            values = { ...presetEnvironment(preset), PK_STORAGE: 'local' };
            output(`${p.model}: $${p.inputPerMillion} input / $${p.outputPerMillion} output per million tokens. Rates verified ${p.verified}. Presets expire after 90 days.\nSource: ${p.source}`);
        }
        else {
            const provider = env.PK_PROVIDER ?? (options.nonInteractive ? undefined : await ask('Provider [openai or anthropic]: '));
            if (!['openai', 'anthropic'].includes(provider ?? ''))
                throw new PKError('SETUP_INPUT', 'Choose openai or anthropic explicitly.');
            values = { PK_STORAGE: 'local', PK_PROVIDER: provider };
            for (const [key, prompt] of [['PK_MODEL', 'Model identifier'], ['PK_INPUT_USD_PER_MILLION', 'Current input USD per million tokens'], ['PK_OUTPUT_USD_PER_MILLION', 'Current output USD per million tokens'], ['PK_PRICING_DATE', 'Date pricing was verified (YYYY-MM-DD)'], ['PK_MAX_INPUT_TOKENS', 'Conservative maximum input tokens per request']])
                values[key] = env[key] ?? (options.nonInteractive ? undefined : await ask(`${prompt}: `));
        }
        const keyName = values.PK_PROVIDER === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
        values[keyName] = env[keyName] ?? (options.nonInteractive ? undefined : await secret('Provider API key (hidden)'));
        const p = readConfig(values).processing;
        createProvider(p); // Validate bounds and dated pricing without making any network request.
        const credentialId = randomUUID();
        await vault.set(credentialId, p.apiKey);
        settings.processing = { provider: p.provider, model: p.model, credentialId, inputPerMillion: p.pricing.inputPerMillion, outputPerMillion: p.pricing.outputPerMillion, pricingDate: p.pricing.version, maxInputTokens: p.maxInputTokens };
    }
    const initialize = dependencies.initialize ?? (async (s, credentials) => {
        const config = readConfig({ ...credentials, PK_STORAGE: s.storage, PK_LIBRARY_DIR: s.libraryDir, PK_IMPORT_DIR: s.importDir });
        const app = new Application(config);
        try {
            await app.initialize();
            if (options.connectAstra && s.storage !== 'astra') {
                const remote = new Application({ ...config, storage: 'astra' });
                try {
                    await remote.initialize();
                }
                finally {
                    remote.close();
                }
            }
            return await app.diagnose();
        }
        finally {
            app.close();
        }
    });
    const readiness = await initialize(settings, credentialEnv);
    await saveSettings(settings, options.settingsDir, previous);
    const protocol = await (dependencies.handshake ?? verifyServerConnection)(options.settingsDir);
    const clients = [];
    for (const client of ['codex', 'claude'])
        if (options.client === client || options.client === 'both')
            clients.push(await registerClient(client, client === 'codex' ? options.codexConfig ?? paths.codex : options.claudeConfig ?? paths.claude, options.settingsDir));
    const skill = options.client === 'codex' || options.client === 'both' ? await installCodexSkill(options.home) : undefined;
    output(`\nSaved research: ${settings.storage === 'local' ? 'on this computer' : 'your Astra database'}\nDocument library: ${settings.libraryDir}\nImport folder: ${settings.importDir ?? join(settings.libraryDir, 'imports')}\nSettings: ${options.settingsDir}`);
    if (clients.length)
        output('Restart the selected client(s), then ask: “Help me research 1920 Rosedale Street NE with Plot & Kin.”\nThe local server connection was tested. Confirm the connection inside each client after restarting.');
    else
        output('Local setup is ready. Run setup again with --client codex, claude, or both to connect a research client.');
    if (options.connectAstra && settings.storage === 'local')
        output('Astra is connected. Existing cases remain local until you explicitly transfer them.');
    return { storage: settings.storage, libraryDir: settings.libraryDir, settingsDir: options.settingsDir, readiness, protocol, clients, skill };
}
//# sourceMappingURL=setup.js.map