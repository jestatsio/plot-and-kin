import { type SavedSettings, type SecretVault } from './settings.js';
export interface SetupOptions {
    nonInteractive: boolean;
    client?: 'codex' | 'claude' | 'both' | 'none';
    storage?: 'local' | 'astra';
    connectAstra: boolean;
    processing: boolean;
    preset?: 'openai' | 'anthropic' | 'custom';
    home: string;
    settingsDir: string;
    libraryDir?: string;
    codexConfig?: string;
    claudeConfig?: string;
}
export declare function parseSetupOptions(args: string[], env?: NodeJS.ProcessEnv): SetupOptions;
export declare function clientConfigPaths(home: string, platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): {
    codex: string;
    claude: string;
};
/** Official stdio registration uses argument arrays. No shell expansion and no secret environment entries. */
export declare function registerClient(client: 'codex' | 'claude', path: string, settingsDir: string, command?: string, entryPoint?: string): Promise<{
    client: "claude" | "codex";
    path: string;
    backup: string | undefined;
    registered: boolean;
    connection: string;
}>;
export declare function installCodexSkill(home: string): Promise<{
    path: string;
    backup: string | undefined;
}>;
export interface SetupDependencies {
    vault?: SecretVault;
    env?: NodeJS.ProcessEnv;
    ask?: (prompt: string) => Promise<string>;
    password?: (prompt: string) => Promise<string>;
    initialize?: (settings: SavedSettings, credentialEnv: NodeJS.ProcessEnv) => Promise<unknown>;
    handshake?: (settingsDir: string) => Promise<unknown>;
    output?: (text: string) => void;
}
export declare function verifyServerConnection(settingsDir: string): Promise<{
    protocol: 'verified';
    tools: number;
}>;
export declare function runSetup(options: SetupOptions, dependencies?: SetupDependencies): Promise<{
    storage: "astra" | "local";
    libraryDir: string;
    settingsDir: string;
    readiness: unknown;
    protocol: unknown;
    clients: {
        client: "claude" | "codex";
        path: string;
        backup: string | undefined;
        registered: boolean;
        connection: string;
    }[];
    skill: {
        path: string;
        backup: string | undefined;
    } | undefined;
}>;
