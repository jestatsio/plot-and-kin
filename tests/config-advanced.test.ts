import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { readConfig } from '../src/config.js';

const ENDPOINT = 'https://test-database-us-east-2.apps.astra.datastax.com';
const providerEnvironment = (provider = 'openai'): NodeJS.ProcessEnv => ({
  PK_STORAGE: 'memory', PK_PROVIDER: provider, PK_MODEL: 'explicit-test-model',
  OPENAI_API_KEY: 'test-openai-key', ANTHROPIC_API_KEY: 'test-anthropic-key',
  PK_INPUT_USD_PER_MILLION: '2.5', PK_OUTPUT_USD_PER_MILLION: '12.5', PK_PRICING_DATE: '2026-10-01', PK_MAX_INPUT_TOKENS: '20000',
});

describe('Astra credentials and portable local paths', () => {
  it('requires an application token even when the endpoint is valid', () => {
    expect(() => readConfig({ ASTRA_DB_API_ENDPOINT: ENDPOINT })).toThrow(/ASTRA_DB_APPLICATION_TOKEN/);
  });
  it('configures Astra explicitly and normalizes its endpoint without falling back to memory', () => {
    const result = readConfig({ ASTRA_DB_API_ENDPOINT: `${ENDPOINT}/`, ASTRA_DB_APPLICATION_TOKEN: 'test-token', ASTRA_DB_KEYSPACE: 'research_keyspace', PK_LIBRARY_DIR: './tmp-library', PK_IMPORT_DIR: './tmp-inbox' });
    expect(result).toMatchObject({ storage: 'astra', endpoint: ENDPOINT, token: 'test-token', keyspace: 'research_keyspace', libraryDir: resolve('tmp-library'), importDir: resolve('tmp-inbox'), exportDir: resolve('tmp-library', 'exports') });
    expect(result.processing).toBeUndefined();
  });
  it('uses stable home-directory defaults for library and import/export locations', () => {
    expect(readConfig({ PK_STORAGE: 'memory' })).toEqual({ storage: 'memory', keyspace: 'default_keyspace', libraryDir: resolve(homedir(), '.plot-and-kin'), importDir: resolve(homedir(), '.plot-and-kin', 'imports'), exportDir: resolve(homedir(), '.plot-and-kin', 'exports') });
  });
  it('does not infer a processing provider from available credentials', () => {
    expect(readConfig({ PK_STORAGE: 'memory', OPENAI_API_KEY: 'unused', ANTHROPIC_API_KEY: 'unused' }).processing).toBeUndefined();
  });
});

describe('explicit provider, pricing, and conservative token settings', () => {
  it.each(['openai', 'anthropic'])('selects only the configured %s provider and its own credential', provider => {
    const result = readConfig(providerEnvironment(provider));
    expect(result.processing).toEqual({ provider, model: 'explicit-test-model', apiKey: provider === 'openai' ? 'test-openai-key' : 'test-anthropic-key', pricing: { inputPerMillion: 2.5, outputPerMillion: 12.5, version: '2026-10-01' }, maxOutputTokens: 4096, maxInputTokens: 20000 });
  });
  it('rejects unsupported providers instead of silently selecting a default', () => {
    expect(() => readConfig(providerEnvironment('other-provider'))).toThrow(/PK_PROVIDER/);
  });
  it.each(['openai', 'anthropic'])('does not borrow credentials from the other provider when %s credentials are missing', provider => {
    const env = providerEnvironment(provider); delete env[provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'];
    expect(() => readConfig(env)).toThrow(/API credentials/);
  });
  it('requires an explicit model even when pricing and both provider keys exist', () => {
    const env = providerEnvironment(); delete env.PK_MODEL;
    expect(() => readConfig(env)).toThrow(/PK_MODEL/);
  });
  it.each(['PK_INPUT_USD_PER_MILLION', 'PK_OUTPUT_USD_PER_MILLION', 'PK_PRICING_DATE'])('requires %s', key => {
    const env = providerEnvironment(); delete env[key];
    expect(() => readConfig(env)).toThrow(/pricing|PRICING_DATE/);
  });
  it.each(['0', '-1', 'NaN', 'Infinity', '', 'not-a-number'])('rejects invalid input and output prices %j', value => {
    for (const key of ['PK_INPUT_USD_PER_MILLION', 'PK_OUTPUT_USD_PER_MILLION']) {
      expect(() => readConfig({ ...providerEnvironment(), [key]: value })).toThrow(/positive.*pricing/);
    }
  });
  it.each([undefined, '0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992'])('rejects absent or unsafe conservative input bound %j', value => {
    expect(() => readConfig({ ...providerEnvironment(), PK_MAX_INPUT_TOKENS: value })).toThrow(/PK_MAX_INPUT_TOKENS/);
  });
  it('accepts the smallest positive integer input bound without changing output limits', () => {
    expect(readConfig({ ...providerEnvironment(), PK_MAX_INPUT_TOKENS: '1' }).processing).toMatchObject({ maxInputTokens: 1, maxOutputTokens: 4096 });
  });
});
