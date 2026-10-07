export interface RuntimeConfig {
    storage: 'local' | 'astra' | 'memory';
    endpoint?: string;
    token?: string;
    keyspace: string;
    astraError?: string;
    processingError?: string;
    resolveAstra?: () => Promise<{
        endpoint: string;
        token: string;
        keyspace: string;
    }>;
    resolveProcessingKey?: () => Promise<string | undefined>;
    libraryDir: string;
    importDir: string;
    exportDir: string;
    processing?: {
        provider: 'openai' | 'anthropic';
        model: string;
        apiKey: string;
        pricing: {
            inputPerMillion: number;
            outputPerMillion: number;
            version: string;
        };
        maxOutputTokens: number;
        maxInputTokens: number;
    };
}
export declare function readConfig(env?: NodeJS.ProcessEnv, options?: {
    tolerateOptional?: boolean;
}): RuntimeConfig;
