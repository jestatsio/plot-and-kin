import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { PKError } from './types.js';
import { validateAstraEndpoint } from './storage.js';

export interface RuntimeConfig {
  storage: 'local' | 'astra' | 'memory';
  endpoint?: string; token?: string; keyspace: string;
  astraError?: string;
  processingError?: string;
  resolveAstra?: () => Promise<{ endpoint: string; token: string; keyspace: string }>;
  resolveProcessingKey?: () => Promise<string | undefined>;
  libraryDir: string; importDir: string; exportDir: string;
  processing?: { provider: 'openai' | 'anthropic'; model: string; apiKey: string; pricing: { inputPerMillion: number; outputPerMillion: number; version: string }; maxOutputTokens: number; maxInputTokens: number };
}
export function readConfig(env: NodeJS.ProcessEnv = process.env, options: { tolerateOptional?: boolean } = {}): RuntimeConfig {
  // Existing explicitly supplied Astra credentials retain their original meaning.
  const storage = env.PK_STORAGE ?? (env.ASTRA_DB_API_ENDPOINT || env.ASTRA_DB_APPLICATION_TOKEN ? 'astra' : 'local');
  if (!['local', 'astra', 'memory'].includes(storage)) throw new PKError('CONFIG', 'PK_STORAGE must be local, astra, or memory');
  const libraryDir = resolve(env.PK_LIBRARY_DIR ?? resolve(homedir(), '.plot-and-kin'));
  const config: RuntimeConfig = { storage: storage as RuntimeConfig['storage'], keyspace: env.ASTRA_DB_KEYSPACE ?? 'default_keyspace', libraryDir, importDir: resolve(env.PK_IMPORT_DIR ?? resolve(libraryDir,'imports')), exportDir: resolve(libraryDir,'exports') };
  if (storage === 'astra' || env.ASTRA_DB_API_ENDPOINT || env.ASTRA_DB_APPLICATION_TOKEN) {
    try {
    config.endpoint = validateAstraEndpoint(env.ASTRA_DB_API_ENDPOINT ?? '');
    config.token = env.ASTRA_DB_APPLICATION_TOKEN;
    if (!config.token) throw new PKError('CONFIG', 'ASTRA_DB_APPLICATION_TOKEN is required');
    } catch (error) {
      if (storage === 'astra') throw error;
      delete config.endpoint; delete config.token;
      config.astraError = 'Astra connection is incomplete. Run plot-and-kin setup --connect-astra. Local cases remain available.';
    }
  }
  if (env.PK_PROVIDER) {
    try {
    if (!['openai', 'anthropic'].includes(env.PK_PROVIDER)) throw new PKError('CONFIG', 'PK_PROVIDER must be openai or anthropic');
    if (!env.PK_MODEL) throw new PKError('CONFIG', 'PK_MODEL is required for the selected provider');
    const provider = env.PK_PROVIDER as 'openai' | 'anthropic';
    const apiKey = provider === 'openai' ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new PKError('CONFIG', 'API credentials are required for the selected provider');
    const inputPerMillion = Number(env.PK_INPUT_USD_PER_MILLION);
    const outputPerMillion = Number(env.PK_OUTPUT_USD_PER_MILLION);
    if (![inputPerMillion,outputPerMillion].every(n => Number.isFinite(n) && n > 0) || !env.PK_PRICING_DATE) throw new PKError('CONFIG', 'Explicit positive input/output pricing and PK_PRICING_DATE are required');
    const maxInputTokens = Number(env.PK_MAX_INPUT_TOKENS);
    if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens < 1) throw new PKError('CONFIG', 'PK_MAX_INPUT_TOKENS must provide a conservative input token bound for the configured model');
    config.processing = { provider, model: env.PK_MODEL, apiKey, pricing: { inputPerMillion, outputPerMillion, version: env.PK_PRICING_DATE }, maxOutputTokens: 4096, maxInputTokens };
    } catch (error) {
      if (!options.tolerateOptional) throw error;
      config.processingError = error instanceof PKError ? error.message : 'Scan interpretation is not configured. Public records and text documents remain available.';
    }
  }
  return config;
}
