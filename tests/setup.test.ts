import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';
import { clientConfigPaths, installCodexSkill, parseSetupOptions, registerClient, runSetup } from '../src/setup.js';
import { readSettings, saveSettings, writePrivateFile, type SavedSettings, type SecretVault } from '../src/settings.js';
import { presetEnvironment } from '../src/processing-presets.js';

const dirs: string[] = [];
const directory = async () => { const dir = await mkdtemp(join(tmpdir(), 'pk-setup-')); dirs.push(dir); return dir; };
afterEach(async () => { vi.useRealTimers(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const dependencyStubs = () => ({ initialize: vi.fn(async (_settings: SavedSettings, _credentials: NodeJS.ProcessEnv) => ({ storage: 'local' })), handshake: vi.fn(async () => ({ protocol: 'verified' })), output: vi.fn(), env: {} });
const answers = (...responses: string[]) => vi.fn(async (_prompt: string) => {
  const response = responses.shift();
  if (response === undefined) throw new Error('Setup requested an unexpected answer');
  return response;
});
const testVault = () => {
  const values = new Map<string, string>();
  return { values, get: vi.fn(async (id: string) => values.get(id)), set: vi.fn(async (id: string, value: string) => { values.set(id, value); }) };
};

describe('safe client registration', () => {
  it.each(['codex', 'claude'] as const)('preserves peer servers and settings for %s, with exact argument arrays', async client => {
    const dir = await directory(); const path = join(dir, client === 'codex' ? 'config.toml' : 'claude.json');
    const original = client === 'codex' ? 'model = "existing-model"\n[mcp_servers.other]\ncommand = "existing"\n' : JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'existing' } } });
    await writePrivateFile(path, original);
    const result = await registerClient(client, path, join(dir, 'settings'), 'C:\\Research Tools\\node.exe', join(dir, 'Évidence space', 'cli.js'));
    expect(result.connection).toBe('pending-client-restart');
    expect(await readFile(result.backup!, 'utf8')).toBe(original);
    const updated = await readFile(path, 'utf8');
    const config = client === 'codex' ? parse(updated) : JSON.parse(updated);
    const servers = config[client === 'codex' ? 'mcp_servers' : 'mcpServers'];
    expect(servers.other).toEqual({ command: 'existing' });
    expect(servers['plot-and-kin']).toEqual({ command: 'C:\\Research Tools\\node.exe', args: [join(dir, 'Évidence space', 'cli.js'), 'serve'], env: { PK_SETTINGS_DIR: join(dir, 'settings') } });
    expect(config[client === 'codex' ? 'model' : 'theme']).toBe(client === 'codex' ? 'existing-model' : 'dark');
  });
  it.each(['codex', 'claude'] as const)('leaves malformed %s configuration intact', async client => {
    const dir = await directory(); const path = join(dir, 'config');
    await writePrivateFile(path, '{malformed');
    await expect(registerClient(client, path, dir)).rejects.toThrow(/not been changed/);
    expect(await readFile(path, 'utf8')).toBe('{malformed');
  });
  it('installs and updates only its own skill, preserving unmanaged files', async () => {
    const dir = await directory(); const installed = await installCodexSkill(dir);
    expect(await readFile(installed.path, 'utf8')).toContain('name: plot-and-kin');
    await installCodexSkill(dir);
    await writePrivateFile(installed.path, 'user authored', await readFile(installed.path, 'utf8'));
    await expect(installCodexSkill(dir)).rejects.toThrow(/not managed/);
    expect(await readFile(installed.path, 'utf8')).toBe('user authored');
  });
  it('isolates test homes and uses Windows roaming paths', async () => {
    const dir = await directory(); const options = parseSetupOptions(['--non-interactive', '--client', 'both', '--home', dir], {});
    expect(options.settingsDir).toBe(join(dir, '.plot-and-kin', 'settings'));
    expect(clientConfigPaths(dir, 'win32', { APPDATA: '/real-user', CODEX_HOME: '/real-user' })).toEqual({ codex: join(dir, '.codex', 'config.toml'), claude: join(dir, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json') });
    expect(() => parseSetupOptions(['--non-interactive'], {})).toThrow(/Choose --client/);
    expect(() => parseSetupOptions(['--token', 'secret'], {})).toThrow(/never/);
  });
});
describe('guided local setup', () => {
  it('guides a first-time researcher through both defaults without asking for credentials', async () => {
    const dir = await directory(); const dependencies = dependencyStubs();
    const ask = answers('', ''); const password = vi.fn(async () => { throw Error('Local research must not request credentials'); });
    const result = await runSetup(parseSetupOptions(['--home', dir], {}), { ...dependencies, ask, password });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(password).not.toHaveBeenCalled();
    expect(result.storage).toBe('local');
    expect(result.clients.map(client => client.client)).toEqual(['codex', 'claude']);
    expect(dependencies.output.mock.calls.flat().join('\n')).toContain('none yet');
    expect(await readSettings(result.settingsDir)).toEqual({ version: 1, storage: 'local', libraryDir: join(dir, '.plot-and-kin') });
  });
  it('initializes a real local library during setup while leaving client selection optional', async () => {
    const dir = await directory(); const dependencies = dependencyStubs();
    const library = join(dir, 'Research library');
    const result = await runSetup(parseSetupOptions(['--home', dir, '--library-dir', library], {}), { ...dependencies, initialize: undefined, ask: answers('4', '1') });
    expect(result.clients).toEqual([]);
    expect(result.readiness).toMatchObject({ storage: { storage: 'local', persistent: true } });
    expect((await readFile(join(library, 'records.sqlite'))).subarray(0, 15).toString()).toBe('SQLite format 3');
    expect(dependencies.output.mock.calls.flat().join('\n')).toContain('Local setup is ready');
  });
  it('detects an existing client and guides optional Astra credential entry outside chat', async () => {
    const dir = await directory(); const dependencies = dependencyStubs(); const vault = testVault();
    const paths = clientConfigPaths(dir);
    await writePrivateFile(paths.codex, 'model = "existing-model"\n');
    const ask = answers('2', '2', 'https://test-db-us-east-2.apps.astra.datastax.com', '');
    const password = vi.fn(async () => 'synthetic-astra-secret');
    const result = await runSetup(parseSetupOptions(['--home', dir], {}), { ...dependencies, ask, password, vault });
    expect(result.storage).toBe('astra');
    expect(result.clients.map(client => client.client)).toEqual(['claude']);
    expect(password).toHaveBeenCalledWith(expect.stringContaining('hidden'));
    expect(dependencies.initialize).toHaveBeenCalledWith(expect.objectContaining({ storage: 'astra', astra: expect.objectContaining({ keyspace: 'default_keyspace' }) }), expect.objectContaining({ ASTRA_DB_APPLICATION_TOKEN: 'synthetic-astra-secret' }));
    const output = dependencies.output.mock.calls.flat().join('\n');
    expect(output).toContain('Detected configuration: codex');
    expect(output).not.toContain('synthetic-astra-secret');
    expect(await readFile(paths.codex, 'utf8')).toBe('model = "existing-model"\n');
    expect(await readFile(join(result.settingsDir, 'settings.json'), 'utf8')).not.toContain('synthetic-astra-secret');
  });
  it.each(['vault', 'environment'] as const)('reuses an existing Astra case library with %s credentials', async source => {
    const dir = await directory(); const dependencies = dependencyStubs(); const vault = testVault();
    const options = parseSetupOptions(['--non-interactive', '--client', 'none', '--home', dir], {});
    const credentialId = randomUUID(); vault.values.set(credentialId, 'existing-vault-token');
    await saveSettings({ version: 1, storage: 'astra', libraryDir: join(dir, 'existing-library'), importDir: join(dir, 'shared-imports'), astra: { endpoint: 'https://test-db-us-east-2.apps.astra.datastax.com', keyspace: 'research', credentialId } }, options.settingsDir);
    const env = source === 'environment' ? { ASTRA_DB_APPLICATION_TOKEN: 'explicit-token' } : {};
    const result = await runSetup(options, { ...dependencies, vault, env });
    expect(result.libraryDir).toBe(join(dir, 'existing-library'));
    expect(dependencies.initialize.mock.calls[0]?.[1]).toMatchObject({ ASTRA_DB_APPLICATION_TOKEN: source === 'environment' ? 'explicit-token' : 'existing-vault-token', ASTRA_DB_KEYSPACE: 'research' });
    expect(vault.get).toHaveBeenCalledTimes(source === 'vault' ? 1 : 0);
    expect(vault.set).not.toHaveBeenCalled();
    expect(dependencies.output.mock.calls.flat().join('\n')).toContain('shared-imports');
  });
  it.each([
    { label: 'client', args: [], responses: ['9'], message: /Choose 1, 2, 3, or 4/ },
    { label: 'storage', args: ['--client', 'none'], responses: ['9'], message: /Choose 1 or 2/ },
    { label: 'provider preset', args: ['--client', 'none', '--storage', 'local', '--processing'], responses: [''], message: /No provider has been selected/ },
    { label: 'custom provider', args: ['--client', 'none', '--storage', 'local', '--processing'], responses: ['3', 'unlisted-provider'], message: /Choose openai or anthropic/ },
  ])('stops an invalid $label answer without creating research or changing settings', async ({ args, responses, message }) => {
    const dir = await directory(); const dependencies = dependencyStubs();
    const options = parseSetupOptions(['--home', dir, ...args], {});
    await expect(runSetup(options, { ...dependencies, ask: answers(...responses), vault: testVault() })).rejects.toThrow(message);
    expect(dependencies.initialize).not.toHaveBeenCalled();
    expect(dependencies.handshake).not.toHaveBeenCalled();
    expect(await readSettings(options.settingsDir)).toBeUndefined();
  });
  it.each([
    { args: ['--storage', 'astra'], env: {}, message: /Astra endpoint and token/ },
    { args: ['--connect-astra'], env: { ASTRA_DB_API_ENDPOINT: 'https://test-db-us-east-2.apps.astra.datastax.com' }, message: /Astra endpoint and token/ },
    { args: ['--processing'], env: {}, message: /Choose openai or anthropic/ },
    { args: ['--preset', 'openai'], env: {}, message: /API credentials/ },
  ])('explains missing non-interactive credentials without starting an incomplete setup ($args)', async ({ args, env, message }) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    const dir = await directory(); const dependencies = dependencyStubs(); const vault = testVault();
    const options = parseSetupOptions(['--non-interactive', '--client', 'none', '--home', dir, ...args], {});
    await expect(runSetup(options, { ...dependencies, env, vault })).rejects.toThrow(message);
    expect(vault.set).not.toHaveBeenCalled();
    expect(dependencies.initialize).not.toHaveBeenCalled();
    expect(await readSettings(options.settingsDir)).toBeUndefined();
  });
  it.each([
    { choice: '1', provider: 'openai', model: 'gpt-4.1-mini-2025-04-14' },
    { choice: '2', provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  ])('guides explicit $provider scan setup, with secure key storage and dated pricing', async ({ choice, provider, model }) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    const dir = await directory(); const dependencies = dependencyStubs(); const vault = testVault();
    const options = parseSetupOptions(['--client', 'none', '--storage', 'local', '--processing', '--home', dir], {});
    const password = vi.fn(async () => 'synthetic-provider-secret');
    const result = await runSetup(options, { ...dependencies, vault, ask: answers(choice), password });
    expect(password).toHaveBeenCalledOnce();
    const saved = await readSettings(result.settingsDir);
    expect(saved?.processing).toMatchObject({ provider, model, pricingDate: '2026-10-01', maxInputTokens: 32768 });
    expect(vault.values.get(saved!.processing!.credentialId)).toBe('synthetic-provider-secret');
    expect(await readFile(join(result.settingsDir, 'settings.json'), 'utf8')).not.toContain('synthetic-provider-secret');
    expect(dependencies.output.mock.calls.flat().join('\n')).toContain('Rates verified 2026-10-01');
    expect(dependencies.output.mock.calls.flat().join('\n')).not.toContain('synthetic-provider-secret');
  });
  it('guides custom scan settings without substituting a provider or hiding cost inputs', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    const dir = await directory(); const dependencies = dependencyStubs(); const vault = testVault();
    const options = parseSetupOptions(['--client', 'none', '--storage', 'local', '--processing', '--home', dir], {});
    const ask = answers('3', 'anthropic', 'researchers-chosen-model', '2', '8', '2026-10-01', '65536');
    const result = await runSetup(options, { ...dependencies, vault, ask, password: async () => 'custom-provider-secret' });
    expect(ask).toHaveBeenCalledTimes(7);
    expect((await readSettings(result.settingsDir))?.processing).toMatchObject({ provider: 'anthropic', model: 'researchers-chosen-model', inputPerMillion: 2, outputPerMillion: 8, maxInputTokens: 65536 });
  });
  it('accepts custom non-interactive provider settings through the environment', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    const dir = await directory(); const dependencies = dependencyStubs(); const vault = testVault();
    const options = parseSetupOptions(['--non-interactive', '--client', 'none', '--preset', 'custom', '--home', dir], {});
    const env = { PK_PROVIDER: 'openai', PK_MODEL: 'configured-model', PK_INPUT_USD_PER_MILLION: '2', PK_OUTPUT_USD_PER_MILLION: '8', PK_PRICING_DATE: '2026-10-01', PK_MAX_INPUT_TOKENS: '65536', OPENAI_API_KEY: 'env-provider-secret' };
    const result = await runSetup(options, { ...dependencies, vault, env });
    expect((await readSettings(result.settingsDir))?.processing).toMatchObject({ provider: 'openai', model: 'configured-model' });
    expect(vault.set).toHaveBeenCalledWith(expect.any(String), 'env-provider-secret');
  });
  it('preserves working settings if a new credential cannot be saved securely', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    const dir = await directory(); const dependencies = dependencyStubs();
    const options = parseSetupOptions(['--non-interactive', '--client', 'none', '--home', dir], {});
    await runSetup(options, dependencies);
    const before = await readFile(join(options.settingsDir, 'settings.json'), 'utf8');
    await expect(runSetup({ ...options, processing: true, preset: 'openai' }, { ...dependencyStubs(), env: { OPENAI_API_KEY: 'unsaved-secret' }, vault: { get: async () => undefined, set: async () => { throw Error('Credential store locked'); } } })).rejects.toThrow(/locked/);
    expect(await readFile(join(options.settingsDir, 'settings.json'), 'utf8')).toBe(before);
  });
  it('supports explicitly chosen client and settings locations without touching default files', async () => {
    const dir = await directory(); const dependencies = dependencyStubs();
    const settingsDir = join(dir, 'profile', 'settings');
    const codex = join(dir, 'profile', 'codex.toml'); const claude = join(dir, 'profile', 'claude.json');
    const options = parseSetupOptions(['--non-interactive', '--client', 'both', '--home', dir, '--settings-dir', settingsDir, '--codex-config', codex, '--claude-config', claude], { PK_SETTINGS_DIR: join(dir, 'ignored-env-settings') });
    const result = await runSetup(options, dependencies);
    expect(result.clients.map(client => client.path)).toEqual([codex, claude]);
    expect(await readSettings(settingsDir)).toBeDefined();
    expect(await readSettings(join(dir, 'ignored-env-settings'))).toBeUndefined();
    await expect(readFile(clientConfigPaths(dir).codex)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(clientConfigPaths(dir).claude)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('allows an explicit legacy Astra migration before replacing the old registration', async () => {
    const dir = await directory(); const vault = testVault(); const dependencies = dependencyStubs();
    const library = join(dir, 'existing-research'); const path = clientConfigPaths(dir).claude;
    const original = JSON.stringify({ mcpServers: { 'plot-and-kin': { command: 'node', env: { PK_LIBRARY_DIR: library, ASTRA_DB_API_ENDPOINT: 'https://test-db-us-east-2.apps.astra.datastax.com', ASTRA_DB_APPLICATION_TOKEN: 'legacy-secret' } } } });
    await writePrivateFile(path, original);
    await writePrivateFile(join(library, 'original-research.txt'), 'Preserve source documents');
    const first = parseSetupOptions(['--non-interactive', '--client', 'none', '--storage', 'astra', '--library-dir', library, '--home', dir], {});
    const env = { ASTRA_DB_API_ENDPOINT: 'https://test-db-us-east-2.apps.astra.datastax.com', ASTRA_DB_APPLICATION_TOKEN: 'legacy-secret' };
    await runSetup(first, { ...dependencies, vault, env });
    expect(await readFile(path, 'utf8')).toBe(original);
    const connected = await runSetup({ ...first, client: 'claude' }, { ...dependencies, vault });
    expect(connected.storage).toBe('astra');
    expect(connected.libraryDir).toBe(library);
    expect(await readFile(path, 'utf8')).not.toContain('legacy-secret');
    expect(await readFile(join(library, 'original-research.txt'), 'utf8')).toBe('Preserve source documents');
    expect(vault.get).toHaveBeenCalledOnce();
  });
  it('rejects an unsafe Astra endpoint before storing a token or contacting storage', async () => {
    const dir = await directory(); const dependencies = dependencyStubs(); const vault = testVault();
    const options = parseSetupOptions(['--non-interactive', '--client', 'none', '--storage', 'astra', '--home', dir], {});
    await expect(runSetup(options, { ...dependencies, vault, env: { ASTRA_DB_API_ENDPOINT: 'http://127.0.0.1:8080', ASTRA_DB_APPLICATION_TOKEN: 'synthetic-secret' } })).rejects.toThrow(/HTTPS Astra/);
    expect(vault.set).not.toHaveBeenCalled();
    expect(dependencies.initialize).not.toHaveBeenCalled();
    expect(await readSettings(options.settingsDir)).toBeUndefined();
  });
  it.each(['codex', 'claude'] as const)('stops first-time setup before mutation when an existing %s file is malformed', async client => {
    const dir = await directory(); const dependencies = dependencyStubs();
    const options = parseSetupOptions(['--non-interactive', '--client', client, '--home', dir], {});
    const path = clientConfigPaths(dir)[client]; await writePrivateFile(path, '{malformed');
    await expect(runSetup(options, dependencies)).rejects.toThrow(/No configuration has been changed/);
    expect(dependencies.initialize).not.toHaveBeenCalled();
    expect(await readFile(path, 'utf8')).toBe('{malformed');
    expect(await readSettings(options.settingsDir)).toBeUndefined();
  });
  it('initializes local storage and validates the server before registering clients', async () => {
    const dir = await directory(); const dependencies = dependencyStubs();
    const result = await runSetup(parseSetupOptions(['--non-interactive', '--client', 'both', '--home', dir], {}), dependencies);
    expect(result.storage).toBe('local'); expect(result.clients).toHaveLength(2);
    expect(dependencies.initialize.mock.invocationCallOrder[0]).toBeLessThan(dependencies.handshake.mock.invocationCallOrder[0]!);
    expect(await readSettings(result.settingsDir)).toMatchObject({ storage: 'local', libraryDir: join(dir, '.plot-and-kin') });
    expect(dependencies.output.mock.calls.flat().join('\n')).toContain('Confirm the connection inside each client');
  });
  it('preserves the selected library and does not reconnect optional Astra on rerun', async () => {
    const dir = await directory(); const options = parseSetupOptions(['--non-interactive', '--client', 'none', '--home', dir], {});
    await runSetup(options, dependencyStubs());
    await expect(runSetup({ ...options, libraryDir: join(dir, 'different') }, dependencyStubs())).rejects.toThrow(/hide existing cases/);
    const again = await runSetup(options, dependencyStubs());
    expect(again.libraryDir).toBe(join(dir, '.plot-and-kin'));
  });
  it('does not change client configuration after an unsuccessful handshake', async () => {
    const dir = await directory(); const options = parseSetupOptions(['--non-interactive', '--client', 'codex', '--home', dir], {});
    await expect(runSetup(options, { ...dependencyStubs(), handshake: async () => { throw Error('offline'); } })).rejects.toThrow('offline');
    await expect(readFile(join(dir, '.codex', 'config.toml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['codex', 'claude'] as const)('refuses to hide legacy %s Astra or custom-library research on first setup', async client => {
    const dir = await directory(); const options = parseSetupOptions(['--non-interactive', '--client', client, '--home', dir], {});
    const path = clientConfigPaths(dir)[client];
    const original = client === 'codex' ? '[mcp_servers.plot-and-kin]\ncommand = "node"\n[mcp_servers.plot-and-kin.env]\nPK_LIBRARY_DIR = "/existing-library"\nASTRA_DB_APPLICATION_TOKEN = "synthetic-token"\n' : JSON.stringify({ mcpServers: { 'plot-and-kin': { command: 'node', env: { PK_LIBRARY_DIR: '/existing-library', ASTRA_DB_APPLICATION_TOKEN: 'synthetic-token' } } } });
    await writePrivateFile(path, original);
    const dependencies = dependencyStubs();
    await expect(runSetup(options, dependencies)).rejects.toMatchObject({ code: 'LEGACY_SETUP', message: expect.stringContaining('setup --client none') });
    expect(dependencies.initialize).not.toHaveBeenCalled();
    expect(dependencies.handshake).not.toHaveBeenCalled();
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(await readSettings(options.settingsDir)).toBeUndefined();
    expect(dependencies.output.mock.calls.flat().join('\n')).not.toContain('synthetic-token');
  });
  it('connects optional Astra while retaining local storage and keeping tokens outside configs', async () => {
    const dir = await directory(); const tokens = new Map<string, string>();
    const vault: SecretVault = { get: async id => tokens.get(id), set: async (id, value) => { tokens.set(id, value); } };
    const result = await runSetup(parseSetupOptions(['--non-interactive', '--client', 'codex', '--home', dir, '--connect-astra'], {}), { ...dependencyStubs(), vault, env: { ASTRA_DB_API_ENDPOINT: 'https://test-db-us-east-2.apps.astra.datastax.com', ASTRA_DB_APPLICATION_TOKEN: 'test-secret' } });
    expect(result.storage).toBe('local'); expect(tokens.size).toBe(1);
    const settings = await readFile(join(result.settingsDir, 'settings.json'), 'utf8');
    expect(settings).not.toContain('test-secret'); expect(settings).toContain('credentialId');
    expect(await readFile(result.clients[0]!.path, 'utf8')).not.toContain('test-secret');
  });
  it('requires explicit provider selection and never silently refreshes pricing dates', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    expect(presetEnvironment('openai')).toMatchObject({ PK_MODEL: 'gpt-4.1-mini-2025-04-14', PK_PRICING_DATE: '2026-10-01' });
    expect(presetEnvironment('anthropic')).toMatchObject({ PK_MODEL: 'claude-haiku-4-5-20251001', PK_INPUT_USD_PER_MILLION: '1', PK_OUTPUT_USD_PER_MILLION: '5' });
    expect(() => presetEnvironment('openai', Date.parse('2027-02-01'))).toThrow(/expired/);
  });
});
