import { PKError } from './types.js';

/** Update only after checking the linked providers' standard (non-batch) rates. */
export const PROCESSING_PRESETS = {
  openai: { provider: 'openai', model: 'gpt-4.1-mini-2025-04-14', inputPerMillion: 0.4, outputPerMillion: 1.6, verified: '2026-10-01', maxInputTokens: 32768, source: 'https://developers.openai.com/api/docs/models/gpt-4.1-mini' },
  anthropic: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', inputPerMillion: 1, outputPerMillion: 5, verified: '2026-10-01', maxInputTokens: 32768, source: 'https://platform.claude.com/docs/en/models/overview' },
} as const;
export function presetEnvironment(provider: keyof typeof PROCESSING_PRESETS, now = Date.now()): NodeJS.ProcessEnv {
  const preset = PROCESSING_PRESETS[provider];
  const age = now - Date.parse(preset.verified);
  if (age > 90 * 86_400_000 || age < -86_400_000) throw new PKError('INVALID_PRICING', 'This release’s pricing preset has expired. Update Plot & Kin or choose custom setup with newly verified rates. Public records and text research remain available.');
  return { PK_PROVIDER: preset.provider, PK_MODEL: preset.model, PK_INPUT_USD_PER_MILLION: String(preset.inputPerMillion), PK_OUTPUT_USD_PER_MILLION: String(preset.outputPerMillion), PK_PRICING_DATE: preset.verified, PK_MAX_INPUT_TOKENS: String(preset.maxInputTokens) };
}
