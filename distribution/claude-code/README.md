# Plot & Kin

Discover the stories behind an address. Plot & Kin helps researchers investigate Washington, DC property history, preserve archival evidence, compare conflicting accounts, and export a dossier with reviewable findings and citations. Start with a real address or a clearly labeled fictional sample. Return to saved cases across conversations.

## Install in Claude Code

Requires **Node.js 22.19 or later, npm, and Claude Code 2.1.291 or later** on your PATH. The default workflow needs no Astra account or model API key. Claude Code installs the exact registry dependencies in the included npm lockfile when it copies this Git plugin into its cache. Installation needs internet access to npm. Dependency lifecycle scripts are disabled by Claude Code.

```sh
claude plugin marketplace add https://github.com/jestatsio/plot-and-kin.git#claude-plugins
claude plugin install plot-and-kin@plot-and-kin
```

Restart Claude Code and ask **“Help me get started with Plot & Kin.”** The plugin provides the `research-property` skill and starts the local MCP server with `node`, using the included readable JavaScript in `dist/`. Its TypeScript source is included in `src/`. No build command, shell bootstrap, or research upload runs during installation. For a ZIP or local directory installation, run `npm ci --ignore-scripts --omit=dev` inside the extracted plugin before loading it with `--plugin-dir`.

## Data and services

Cases, original documents, review decisions, and exports persist in your home directory's `.plot-and-kin` library, outside the plugin cache. Updates and removal preserve the library. JEStats operates no hosted research service and receives no product telemetry or automatic research uploads. Your conversation and requested tool output are handled by Claude under your account's privacy settings.

DC public-source queries contact HistoryQuest and Sanborn map services. Importing a public document URL contacts its operator. Optional Astra stores structured research only when configured and selected or when you explicitly transfer a case. Optional OpenAI or Anthropic scan processing sends the requested document content to your selected provider and uses your configured budget. The default processing cap is $10 per project, excluding Claude and database charges. Credentials are entered through guided setup outside chat and stored in macOS Keychain or Windows DPAPI. Run `node dist/cli.js setup --client none --connect-astra` or `node dist/cli.js setup --client none --processing` from the plugin directory to configure these options.

Originals are not backed up by Astra. Exports and backups are not automatically redacted. Local research remains until you delete it yourself. See the [privacy notice](https://jestatsio.github.io/plot-and-kin/privacy.html) for retention and all data flows.

## Scope and updates

This is a researcher-facing prototype with selected Washington, DC building records, historical map excerpts, and documents you are permitted to import. Sources provide leads, not comprehensive coverage. Findings remain proposed until you explicitly approve them. The server records that review but cannot independently authenticate the chat's reviewer. Model extraction quality and the full researcher journey remain under evaluation.

Use `claude plugin update plot-and-kin@plot-and-kin` for published updates, then restart your session. Make a portable case backup before upgrading. A custom marketplace installation is separate from approval in Anthropic's public directory.

[Documentation](https://jestatsio.github.io/plot-and-kin/) · [Source](https://github.com/jestatsio/plot-and-kin) · [Support](https://github.com/jestatsio/plot-and-kin/issues) · [Apache-2.0 license](LICENSE)

Support issues are public. Do not include private research, personal addresses, or credentials in them.
