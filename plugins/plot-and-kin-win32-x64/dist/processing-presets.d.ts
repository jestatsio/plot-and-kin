/** Update only after checking the linked providers' standard (non-batch) rates. */
export declare const PROCESSING_PRESETS: {
    readonly openai: {
        readonly provider: 'openai';
        readonly model: 'gpt-4.1-mini-2025-04-14';
        readonly inputPerMillion: 0.4;
        readonly outputPerMillion: 1.6;
        readonly verified: '2026-10-01';
        readonly maxInputTokens: 32768;
        readonly source: 'https://developers.openai.com/api/docs/models/gpt-4.1-mini';
    };
    readonly anthropic: {
        readonly provider: 'anthropic';
        readonly model: 'claude-haiku-4-5-20251001';
        readonly inputPerMillion: 1;
        readonly outputPerMillion: 5;
        readonly verified: '2026-10-01';
        readonly maxInputTokens: 32768;
        readonly source: 'https://platform.claude.com/docs/en/models/overview';
    };
};
export declare function presetEnvironment(provider: keyof typeof PROCESSING_PRESETS, now?: number): NodeJS.ProcessEnv;
