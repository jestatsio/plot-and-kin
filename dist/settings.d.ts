import { z } from 'zod';
import { type RuntimeConfig } from './config.js';
declare const settingsSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    storage: z.ZodEnum<{
        astra: "astra";
        local: "local";
    }>;
    libraryDir: z.ZodString;
    importDir: z.ZodOptional<z.ZodString>;
    astra: z.ZodOptional<z.ZodObject<{
        endpoint: z.ZodString;
        keyspace: z.ZodString;
        credentialId: z.ZodString;
    }, z.core.$strict>>;
    processing: z.ZodOptional<z.ZodObject<{
        provider: z.ZodEnum<{
            anthropic: "anthropic";
            openai: "openai";
        }>;
        model: z.ZodString;
        credentialId: z.ZodString;
        inputPerMillion: z.ZodNumber;
        outputPerMillion: z.ZodNumber;
        pricingDate: z.ZodString;
        maxInputTokens: z.ZodNumber;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type SavedSettings = z.infer<typeof settingsSchema>;
export interface SecretVault {
    get(id: string): Promise<string | undefined>;
    set(id: string, value: string): Promise<void>;
}
export declare const settingsDirectory: (env?: NodeJS.ProcessEnv) => string;
/** Restrict reads to bounded ordinary files, never silently follow a settings symlink. */
export declare function readPrivateFile(path: string): Promise<string | undefined>;
/** Serializes writers and checks the expected bytes to avoid lost host-configuration edits. */
export declare function writePrivateFile(path: string, content: string, expected?: string, backup?: boolean): Promise<string | undefined>;
export declare function readSettings(dir?: string): Promise<SavedSettings | undefined>;
export declare function saveSettings(settings: SavedSettings, dir?: string, expected?: string): Promise<void>;
export declare function encodeKeychainSecret(value: string): string;
export declare function decodeKeychainSecret(value: string): string;
export declare class OperatingSystemVault implements SecretVault {
    private readonly dir;
    private readonly platform;
    constructor(dir?: string, platform?: NodeJS.Platform);
    private service;
    set(id: string, value: string): Promise<void>;
    get(id: string): Promise<string | undefined>;
}
export declare function loadRuntimeConfig(env?: NodeJS.ProcessEnv, vault?: SecretVault): Promise<RuntimeConfig>;
export declare function loadAstraConfig(env?: NodeJS.ProcessEnv, vault?: SecretVault): Promise<RuntimeConfig>;
export {};
