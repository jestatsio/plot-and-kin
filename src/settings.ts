import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { readConfig, type RuntimeConfig } from './config.js';
import { PKError } from './types.js';

const settingsSchema = z.object({
  version: z.literal(1), storage: z.enum(['local', 'astra']), libraryDir: z.string().min(1), importDir: z.string().min(1).optional(),
  astra: z.object({ endpoint: z.string().min(1), keyspace: z.string().min(1), credentialId: z.string().uuid() }).strict().optional(),
  processing: z.object({ provider: z.enum(['openai', 'anthropic']), model: z.string().min(1), credentialId: z.string().uuid(), inputPerMillion: z.number().positive(), outputPerMillion: z.number().positive(), pricingDate: z.string().min(1), maxInputTokens: z.number().int().positive() }).strict().optional(),
}).strict();
export type SavedSettings = z.infer<typeof settingsSchema>;
export interface SecretVault { get(id: string): Promise<string | undefined>; set(id: string, value: string): Promise<void> }
export const settingsDirectory = (env: NodeJS.ProcessEnv = process.env): string => resolve(env.PK_SETTINGS_DIR ?? join(homedir(), '.plot-and-kin', 'settings'));

/** Restrict reads to bounded ordinary files, never silently follow a settings symlink. */
export async function readPrivateFile(path: string): Promise<string | undefined> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new PKError('SETTINGS', 'Cannot safely read settings. Check file permissions and avoid symlinks.'); }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new PKError('SETTINGS', 'Settings must be an ordinary file smaller than 1 MiB.');
    const text = await handle.readFile('utf8');
    if (Buffer.byteLength(text) > 1024 * 1024) throw new PKError('SETTINGS', 'Settings exceed 1 MiB.');
    return text;
  } finally { await handle.close(); }
}

/** Serializes writers and checks the expected bytes to avoid lost host-configuration edits. */
export async function writePrivateFile(path: string, content: string, expected?: string, backup = false): Promise<string | undefined> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lockPath = `${path}.pk-lock`;
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new PKError('SETTINGS_BUSY', 'Another setup may be changing settings. Close it and retry. A leftover .pk-lock file can be removed after checking no setup is running.'); }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const current = await readPrivateFile(path);
    if (current !== expected) throw new PKError('SETTINGS_CONFLICT', 'Settings changed while setup was running. Retry to preserve the other changes.');
    let backupPath: string | undefined;
    if (backup && current !== undefined && current !== content) {
      backupPath = `${path}.pk-backup-${Date.now()}-${randomUUID()}`;
      const handle = await open(backupPath, 'wx', 0o600);
      try { await handle.writeFile(current); await handle.sync(); } finally { await handle.close(); }
    }
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path);
    return backupPath;
  } finally {
    await unlink(temporary).catch(() => undefined);
    await lock.close(); await unlink(lockPath);
  }
}

export async function readSettings(dir = settingsDirectory()): Promise<SavedSettings | undefined> {
  const content = await readPrivateFile(join(dir, 'settings.json'));
  if (content === undefined) return undefined;
  try { return settingsSchema.parse(JSON.parse(content)); }
  catch { throw new PKError('SETTINGS', 'Saved settings are invalid or use an unsupported version. Run setup with a new settings directory or restore the settings backup.'); }
}
export async function saveSettings(settings: SavedSettings, dir = settingsDirectory(), expected?: string): Promise<void> {
  const validated = settingsSchema.parse(settings);
  await writePrivateFile(join(dir, 'settings.json'), `${JSON.stringify(validated, null, 2)}\n`, expected, true);
}

// Secrets travel over stdin, never through command arguments or host configuration.
function runSecretCommand(command: string, args: string[], input: string): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = ''; let size = 0;
    const fail = () => reject(new PKError('CREDENTIAL_STORE', 'The operating system credential store was unavailable. Unlock it and retry setup. No credential was saved in plain text.'));
    const timer = setTimeout(() => { child.kill(); fail(); }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 64 * 1024) child.kill(); else output += chunk.toString(); });
    child.stderr.resume();
    child.once('error', () => { clearTimeout(timer); fail(); });
    child.once('close', code => { clearTimeout(timer); if (code !== 0 || size > 64 * 1024) fail(); else resolveResult(output.trim()); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}
const quoteSecurity = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
export class OperatingSystemVault implements SecretVault {
  constructor(private readonly dir = settingsDirectory(), private readonly platform = process.platform) {}
  private service() { return `io.jestats.plot-and-kin.${createHash('sha256').update(resolve(this.dir)).digest('hex').slice(0, 24)}`; }
  async set(id: string, value: string): Promise<void> {
    if (!/^[\da-f-]{36}$/.test(id) || !value || /[\r\n\0]/.test(value) || value.length > 16_000) throw new PKError('CREDENTIAL_STORE', 'Credential must be a nonempty, single-line value.');
    if (this.platform === 'darwin') {
      await runSecretCommand('/usr/bin/security', ['-i'], `add-generic-password -U -s ${quoteSecurity(this.service())} -a ${quoteSecurity(id)} -w ${quoteSecurity(value)}\n`);
      // Interactive security mode may exit successfully after a failed command. Verify the saved value.
      if (await this.get(id) !== value) throw new PKError('CREDENTIAL_STORE', 'The keychain did not confirm the saved credential. Unlock it and retry.');
      return;
    }
    if (this.platform === 'win32') {
      const script = "$ErrorActionPreference='Stop'; $s=[Console]::In.ReadToEnd(); $secure=ConvertTo-SecureString $s -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString $secure))";
      const encrypted = await runSecretCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], value);
      const path = join(this.dir, 'credentials', `${id}.dpapi`);
      await writePrivateFile(path, encrypted, await readPrivateFile(path));
      return;
    }
    throw new PKError('CREDENTIAL_STORE', 'Saved credentials are supported on macOS and Windows. On this system, use environment variables for Astra or scan processing. Local research needs no credentials.');
  }
  async get(id: string): Promise<string | undefined> {
    if (!/^[\da-f-]{36}$/.test(id)) throw new PKError('CREDENTIAL_STORE', 'Saved credential identifier is invalid.');
    if (this.platform === 'darwin') return runSecretCommand('/usr/bin/security', ['find-generic-password', '-s', this.service(), '-a', id, '-w'], '');
    if (this.platform === 'win32') {
      const encrypted = await readPrivateFile(join(this.dir, 'credentials', `${id}.dpapi`));
      if (!encrypted) return undefined;
      const script = "$ErrorActionPreference='Stop'; $secure=ConvertTo-SecureString ([Console]::In.ReadToEnd()); $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }";
      return runSecretCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], encrypted);
    }
    throw new PKError('CREDENTIAL_STORE', 'This system does not support the saved credential store. Use environment variables.');
  }
}

export async function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env, vault: SecretVault = new OperatingSystemVault(settingsDirectory(env))): Promise<RuntimeConfig> {
  const saved = await readSettings(settingsDirectory(env));
  const merged: NodeJS.ProcessEnv = {};
  if (saved) {
    Object.assign(merged, { PK_STORAGE: saved.storage, PK_LIBRARY_DIR: saved.libraryDir, PK_IMPORT_DIR: saved.importDir });
    if (saved.astra) {
      Object.assign(merged, { ASTRA_DB_API_ENDPOINT: saved.astra.endpoint, ASTRA_DB_KEYSPACE: saved.astra.keyspace });
    }
    // A different explicit provider must supply its own model and pricing. Never
    // reuse the other provider's metadata or ask its credential store for a key.
    if (saved.processing && (env.PK_PROVIDER === undefined || env.PK_PROVIDER === saved.processing.provider)) {
      const p = saved.processing;
      Object.assign(merged, { PK_PROVIDER: p.provider, PK_MODEL: p.model, PK_INPUT_USD_PER_MILLION: String(p.inputPerMillion), PK_OUTPUT_USD_PER_MILLION: String(p.outputPerMillion), PK_PRICING_DATE: p.pricingDate, PK_MAX_INPUT_TOKENS: String(p.maxInputTokens) });
    }
  }
  // Undefined keys must not erase saved defaults. Empty strings intentionally disable optional providers.
  for (const [key, value] of Object.entries(env)) if (value !== undefined) merged[key] = value;

  const storage = merged.PK_STORAGE ?? (merged.ASTRA_DB_API_ENDPOINT || merged.ASTRA_DB_APPLICATION_TOKEN ? 'astra' : 'local');
  const lazyAstra = saved?.astra && env.ASTRA_DB_APPLICATION_TOKEN === undefined;
  const resolveAstra = async () => {
    let token: string | undefined;
    try { token = await vault.get(saved!.astra!.credentialId); }
    catch { throw new PKError('CREDENTIAL_STORE', 'Unlock your operating system credential store before opening an Astra case. Local cases remain available.'); }
    const config = readConfig({ PK_STORAGE: 'astra', ASTRA_DB_API_ENDPOINT: merged.ASTRA_DB_API_ENDPOINT, ASTRA_DB_KEYSPACE: merged.ASTRA_DB_KEYSPACE, ASTRA_DB_APPLICATION_TOKEN: token });
    return { endpoint: config.endpoint!, token: config.token!, keyspace: config.keyspace };
  };
  if (lazyAstra && storage === 'astra') {
    // Astra is mandatory only when it is the active store.
    merged.ASTRA_DB_APPLICATION_TOKEN = (await resolveAstra()).token;
  } else if (lazyAstra) {
    // Validate nonsecret metadata without opening an optional OS keychain. This
    // marker is removed before returning and can never reach a request adapter.
    merged.ASTRA_DB_APPLICATION_TOKEN = 'deferred-credential-validation-only';
  }
  const selectedProvider = merged.PK_PROVIDER;
  const providerKey = selectedProvider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const lazyProcessing = Boolean(selectedProvider && saved?.processing?.provider === selectedProvider && env[providerKey] === undefined);
  if (lazyProcessing) merged[providerKey] = 'deferred-credential-validation-only';
  const config = readConfig(merged, { tolerateOptional: true });
  if (lazyAstra && storage !== 'astra') {
    delete config.token;
    if (config.endpoint) config.resolveAstra = resolveAstra;
  }
  if (lazyProcessing && config.processing) {
    config.processing.apiKey = '';
    config.resolveProcessingKey = async () => {
      try { return await vault.get(saved!.processing!.credentialId); }
      catch { throw new PKError('CREDENTIAL_STORE', 'Unlock your operating system credential store to use scan interpretation. Text documents remain available.'); }
    };
  }
  return config;
}
export async function loadAstraConfig(env: NodeJS.ProcessEnv = process.env, vault?: SecretVault): Promise<RuntimeConfig> {
  return loadRuntimeConfig({ ...env, PK_STORAGE: 'astra' }, vault);
}
