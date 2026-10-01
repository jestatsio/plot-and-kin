import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { PKError } from './types.js';
import { validateAstraEndpoint } from './storage.js';

export interface RuntimeConfig {
  storage: 'astra' | 'memory';
  endpoint?: string; token?: string; keyspace: string;
  libraryDir: string; importDir: string; exportDir: string;
  processing?: { provider: 'openai' | 'anthropic'; model: string; apiKey: string; pricing: { inputPerMillion: number; outputPerMillion: number; version: string }; maxOutputTokens: number; maxInputTokens: number };
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const storage = env.PK_STORAGE ?? 'astra';
  if (!['astra', 'memory'].includes(storage)) throw new PKError('CONFIG', 'PK_STORAGE must be astra or memory');
  const libraryDir = resolve(env.PK_LIBRARY_DIR ?? resolve(homedir(), '.plot-and-kin'));
  const config: RuntimeConfig = { storage: storage as 'astra' | 'memory', keyspace: env.ASTRA_DB_KEYSPACE ?? 'default_keyspace', libraryDir, importDir: resolve(env.PK_IMPORT_DIR ?? resolve(libraryDir,'imports')), exportDir: resolve(libraryDir,'exports') };
  if (storage === 'astra') {
    config.endpoint = validateAstraEndpoint(env.ASTRA_DB_API_ENDPOINT ?? '');
    config.token = env.ASTRA_DB_APPLICATION_TOKEN;
    if (!config.token) throw new PKError('CONFIG', 'ASTRA_DB_APPLICATION_TOKEN is required');
  }
  if (env.PK_PROVIDER) {
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
  }
  return config;
}
