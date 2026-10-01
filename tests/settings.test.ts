import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadRuntimeConfig, loadAstraConfig, readPrivateFile, readSettings, saveSettings, writePrivateFile, type SavedSettings, type SecretVault } from '../src/settings.js';

const dirs: string[] = [];
const directory = async () => { const dir = await mkdtemp(join(tmpdir(), 'pk-settings-')); dirs.push(dir); return dir; };
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const ENDPOINT = 'https://test-database-us-east-2.apps.astra.datastax.com';
const vault: SecretVault = { get: async () => 'vault-token', set: async () => undefined };

describe('private, versioned settings', () => {
  it('starts with persistent local research without reading credentials', async () => {
    const dir = await directory();
    expect(await loadRuntimeConfig({ PK_SETTINGS_DIR: dir }, { get: async () => { throw Error('Should not load credentials'); }, set: vault.set })).toMatchObject({ storage: 'local' });
  });
  it('saves no credentials and applies explicit environment overrides', async () => {
    const dir = await directory();
    const settings: SavedSettings = { version: 1, storage: 'local', libraryDir: join(dir, 'library'), astra: { endpoint: ENDPOINT, keyspace: 'research', credentialId: randomUUID() } };
    await saveSettings(settings, dir);
    const content = await readFile(join(dir, 'settings.json'), 'utf8');
    expect(content).not.toContain('vault-token');
    expect(await readSettings(dir)).toEqual(settings);
    const local = await loadRuntimeConfig({ PK_SETTINGS_DIR: dir }, vault);
    expect(local).toMatchObject({ storage: 'local', endpoint: ENDPOINT, keyspace: 'research' });
    expect(local.token).toBeUndefined();
    expect(await local.resolveAstra!()).toEqual({ endpoint: ENDPOINT, token: 'vault-token', keyspace: 'research' });
    expect(await loadAstraConfig({ PK_SETTINGS_DIR: dir, ASTRA_DB_APPLICATION_TOKEN: 'explicit-token' }, vault)).toMatchObject({ storage: 'astra', token: 'explicit-token' });
  });
  it('retains local research when the optional credential store is locked', async () => {
    const dir = await directory();
    await saveSettings({ version: 1, storage: 'local', libraryDir: dir, astra: { endpoint: ENDPOINT, keyspace: 'default_keyspace', credentialId: randomUUID() } }, dir);
    const locked: SecretVault = { get: async () => { throw Error('locked'); }, set: vault.set };
    const local = await loadRuntimeConfig({ PK_SETTINGS_DIR: dir }, locked);
    expect(local.storage).toBe('local');
    await expect(local.resolveAstra!()).rejects.toThrow(/Unlock/);
    await expect(loadAstraConfig({ PK_SETTINGS_DIR: dir }, locked)).rejects.toThrow(/Unlock/);
  });
  it('isolates incomplete optional processing and never switches providers', async () => {
    const dir = await directory();
    const config = await loadRuntimeConfig({ PK_SETTINGS_DIR: dir, PK_PROVIDER: 'anthropic', OPENAI_API_KEY: 'other-provider', PK_MODEL: 'model' });
    expect(config).toMatchObject({ storage: 'local', processingError: expect.stringContaining('credentials') });
    expect(config.processing).toBeUndefined();
  });
  it('does not wait for optional credentials before opening local research', async () => {
    const dir = await directory();
    await saveSettings({ version: 1, storage: 'local', libraryDir: dir, astra: { endpoint: ENDPOINT, keyspace: 'default_keyspace', credentialId: randomUUID() }, processing: { provider: 'openai', model: 'saved-model', credentialId: randomUUID(), inputPerMillion: 1, outputPerMillion: 2, pricingDate: '2026-10-01', maxInputTokens: 32768 } }, dir);
    const get = vi.fn(() => new Promise<string>(() => undefined));
    const config = await loadRuntimeConfig({ PK_SETTINGS_DIR: dir }, { get, set: vault.set });
    expect(get).not.toHaveBeenCalled();
    expect(config.token).toBeUndefined();
    expect(config.processing?.apiKey).toBe('');
    expect(config.resolveAstra).toBeTypeOf('function');
    expect(config.resolveProcessingKey).toBeTypeOf('function');
    expect(JSON.stringify(config)).not.toContain('deferred-credential');
  });
  it('resolves a processing key only on demand and respects disabled or overridden providers', async () => {
    const dir = await directory();
    await saveSettings({ version: 1, storage: 'local', libraryDir: dir, processing: { provider: 'openai', model: 'saved-model', credentialId: randomUUID(), inputPerMillion: 1, outputPerMillion: 2, pricingDate: '2026-10-01', maxInputTokens: 32768 } }, dir);
    const get = vi.fn(async () => 'provider-secret');
    const credentialVault = { get, set: vault.set };
    const config = await loadRuntimeConfig({ PK_SETTINGS_DIR: dir }, credentialVault);
    expect(get).not.toHaveBeenCalled();
    expect(await config.resolveProcessingKey!()).toBe('provider-secret');
    get.mockClear();
    const disabled = await loadRuntimeConfig({ PK_SETTINGS_DIR: dir, PK_PROVIDER: '' }, credentialVault);
    expect(disabled.processing).toBeUndefined();
    expect(disabled.processingError).toBeUndefined();
    const explicit = await loadRuntimeConfig({ PK_SETTINGS_DIR: dir, OPENAI_API_KEY: 'explicit-key' }, credentialVault);
    expect(explicit.processing?.apiKey).toBe('explicit-key');
    expect(explicit.resolveProcessingKey).toBeUndefined();
    const switched = await loadRuntimeConfig({ PK_SETTINGS_DIR: dir, PK_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'explicit-key' }, credentialVault);
    expect(switched.processing).toBeUndefined();
    expect(switched.processingError).toContain('PK_MODEL');
    expect(get).not.toHaveBeenCalled();
  });
  it('rejects unknown schema and secret-bearing settings rather than ignoring them', async () => {
    const dir = await directory(); const path = join(dir, 'settings.json');
    await writePrivateFile(path, JSON.stringify({ version: 1, storage: 'local', libraryDir: dir, token: 'do-not-save' }));
    await expect(readSettings(dir)).rejects.toThrow(/invalid/);
  });
  it('detects concurrent edits and backs up replaced content', async () => {
    const dir = await directory(); const path = join(dir, 'settings.json');
    await writePrivateFile(path, 'old');
    await expect(writePrivateFile(path, 'new', 'stale')).rejects.toThrow(/changed/);
    expect(await readPrivateFile(path)).toBe('old');
    const backup = await writePrivateFile(path, 'new', 'old', true);
    expect(await readFile(backup!, 'utf8')).toBe('old');
    expect(await readPrivateFile(path)).toBe('new');
  });
  it.skipIf(process.platform === 'win32')('refuses a symlink settings target', async () => {
    const dir = await directory(); const target = join(dir, 'other'); const link = join(dir, 'settings.json');
    await writePrivateFile(target, 'original'); await symlink(target, link);
    await expect(readPrivateFile(link)).rejects.toThrow(/safely/);
    await expect(writePrivateFile(link, 'new')).rejects.toThrow(/safely/);
    expect(await readFile(target, 'utf8')).toBe('original');
  });
});
