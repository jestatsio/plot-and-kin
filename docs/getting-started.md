# Getting started

**Last updated: October 7, 2026**

Start with an address and a question. Plot & Kin saves cases on your computer by default, so public building records, text documents, evidence review, and dossiers need no Astra account or separate model API key. Codex, Claude Code, or Claude Desktop supplies the research conversation. The client's own account and charges are separate.

[Project overview](../README.md) · [Documentation site](https://jestatsio.github.io/plot-and-kin/) · [Evidence and data](evidence-and-data.md) · [Privacy](privacy.md) · [Validation](validation.md)

## Install and connect

**Release status:** [v0.1.0](https://github.com/jestatsio/plot-and-kin/releases/tag/v0.1.0) and the Codex and Claude Code Git catalogs are published. Official directory approval remains separate. Automated package checks pass on all three supported platforms, and the Apple Silicon Claude Desktop walkthrough covers installation through a sample dossier export. See [client acceptance](client-acceptance.md) for remaining desktop checks.

### Client packages: runtime included

Follow the [release download guide](distribution.md#release-downloads) to choose a package for **Mac Apple Silicon**, **Mac Intel**, or **Windows x64**:

- **Claude Desktop:** download the matching `.mcpb`, then use **Settings → Extensions → Advanced settings → Install extension**.
- **Codex:** extract the matching `-codex.zip`, add its folder as a local marketplace source, then install Plot & Kin. You can also use the published Git marketplace.

Both packages include their runtime and start with persistent local storage. No Node.js installation, database account, model API key, or guided setup is needed for your first local case. Codex local-source registration may require its CLI depending on the client version. Start a new chat and ask **“Help me get started with Plot & Kin.”** Your client's account and public-source network access are still required.

Use [client packages and marketplace installation](distribution.md) for exact files and commands. The release also includes a [bundled guided setup](distribution.md#guided-setup-from-a-preview) for either or both clients. A custom marketplace is separate from an approved public-directory listing. If you already connected this client through guided setup, follow the migration steps there to avoid duplicate tools.

### Claude Code

Install the [Claude Code Git plugin](distribution.md#claude-code). It requires Node.js 22.19+, npm, and Claude Code 2.1.291+. The native Codex and Claude Desktop packages above include their runtime.

### Available now: developer checkout

Install Node.js **22.19 or later**, npm, and Git, then run:

```sh
git clone https://github.com/jestatsio/plot-and-kin.git
cd plot-and-kin
npm ci
npm run build
node dist/cli.js setup
```

Setup asks which client to connect and recommends **Save on this computer**. It initializes a persistent SQLite database, tests a real local MCP connection, preserves unrelated client settings, and backs up changed configuration files. The research workflow is installed for Codex, with equivalent server instructions and prompts available to both clients. No JSON or TOML editing is needed.

Restart the selected clients. The setup command verifies the server process, while you confirm the connection in the actual client by asking **“Help me get started with Plot & Kin.”** A successful command does not prove that a desktop application has connected.

Keep the checkout and Node executable in place while using this developer installation. Setup registers their absolute paths. Moving or deleting them requires rerunning setup from the new location.

### After a packaged release is published

These commands download a versioned bundle, verify its checksum, check its bundled Node runtime and native document dependencies, then launch guided setup. The packaged path requires no separate Node or Git installation.

**macOS Terminal, Apple Silicon or Intel:**

```sh
curl -fsSL https://github.com/jestatsio/plot-and-kin/releases/latest/download/install.sh | sh
```

**Windows PowerShell, x64:**

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://github.com/jestatsio/plot-and-kin/releases/latest/download/install.ps1')))
```

Only use these commands after the [Releases page](https://github.com/jestatsio/plot-and-kin/releases) contains an accepted release for your platform. This guided path is an alternative to installing a client package. Windows ARM64 is not a validated target. macOS is the priority, with Windows developed and tested alongside it. Public-directory distribution is a separate gate, not a prerequisite for local setup.

Rerun the installer to update or repair configuration. Versioned runtime directories are separate from research and settings. Setup does not remove old runtimes, cases, or the library. If the download or health check fails, it reports the problem before activating that runtime.

### Setup options for developers and administrators

From a built checkout:

```sh
node dist/cli.js setup --non-interactive --client both --storage local
```

Choose `--client codex`, `claude`, `both`, or `none`. Optional `--home`, `--settings-dir`, `--library-dir`, `--codex-config`, and `--claude-config` paths support isolated installations and tests. Rerunning setup preserves the saved library location. Use backup and restore to move research to a new library.

The default settings directory is `~/.plot-and-kin/settings`. Client registration contains the runtime command and settings-directory reference. Credentials are kept outside client configuration and outside chat.

## Your first case

Start with any of these requests in either client:

| What you want | What to say |
| --- | --- |
| Get oriented | “Help me get started with Plot & Kin.” |
| Explore without historical claims | “Show me the Plot & Kin sample.” |
| Research a property | “Research 1920 Rosedale Street NE in Washington, DC. What do the available records say about its early construction?” |
| Return to saved work | “Continue my Rosedale Street case.” |
| Review progress | “Show my findings awaiting review and the next useful step.” |
| Save the result | “Show the dossier here and save an HTML copy.” |

The client should ask for the address and question first, then gather relevant facts and source restrictions as needed. If several cases match, it should ask which you mean. You do not need to copy internal project IDs.

A first case can use DC public building records without scan processing. The client presents candidate matches and proposed findings with citations. Inspect the evidence and wording before approving, revising, or leaving a finding unresolved. Compiled building information is a lead to examine. A permit date is not automatically a construction date, and ownership does not establish occupancy.

The default run allows **30 minutes, 25 external search requests, and 50 processed pages**. Progress and next steps remain saved when a limit stops research. Unsuccessful searches are retained without becoming evidence of absence.

Review decisions record your stated approval and the exact reviewed version. This is an audited chat workflow, not an independently authenticated human-only control.

### The sample and the CLI demo

The in-chat sample is visibly fictional and is saved in your configured storage. It never invents a human approval. The separate `node dist/cli.js demo` command exercises a synthetic dossier and backup/restore round trip using temporary in-memory records. Its exported files persist, but its records disappear when the process ends.

## Where your work lives

Setup prints your actual locations. By default:

| Location under your home directory | Purpose |
| --- | --- |
| `.plot-and-kin/records.sqlite` | Persistent local research database |
| `.plot-and-kin/blobs` | Original documents and derived images, addressed by content hash |
| `.plot-and-kin/imports` | Permitted documents you want the server to import |
| `.plot-and-kin/exports` | Named dossiers and portable backups |
| `.plot-and-kin/settings` | Nonsecret preferences and credential references |
| `.plot-and-kin/runtime/versions` | Replaceable packaged runtime installations |

Ask **“Where should I put my document?”** The client can list the import folder and filenames. Place the document there, then ask to import it by name. Chat attachments are usable only when the client explicitly supplies their contents. A file visible in chat is not automatically readable by the local server.

Export filenames include the case address. Open them from the printed export folder in Finder or File Explorer. If your client cannot open local files, ask to see the dossier directly in chat.

## Connect Astra when you want it

Astra is optional. It stores structured research in your own database. Original files and derived images remain local, so an Astra connection is **not a cloud backup of your document library**.

In a developer checkout, run:

```sh
node dist/cli.js setup --client none --connect-astra
```

For a packaged installation, use the bundled runtime's setup command with **`--client none --connect-astra`**. The [package guide](distribution.md#optional-astra-and-scan-processing) explains how to run it without a separate Node installation. `--client none` preserves the existing extension/plugin connection and avoids adding a second server registration. Setup guides you to create a serverless database and requests its endpoint, keyspace, and token. Enter credentials in the masked terminal prompt, never in chat or command arguments.

Only `pk_records` and `pk_passages` are initialized. Unrelated collections remain untouched. The capability check verifies the tested Astra lexical-search configuration, which remains a preview capability.

**Connecting Astra keeps existing cases local.** Restart your clients after configuration, then ask to move a specific case to Astra. Review and explicitly approve the transfer. Plot & Kin preserves and verifies sources, citation anchors, corrections, review history, logs, and processing-budget state before switching that case's location. The original local case remains a read-only archive. There is no automatic synchronization or duplicate active copy.

A failed transfer does not silently switch locations. Follow the saved transfer status to resume or cancel. After an interrupted process, confirm it has stopped before authorizing recovery. An uncertain paid operation remains uncertain after transfer and does not become eligible for automatic retry.

`setup --storage astra` is an explicit change of the installation's default backend. It does not move existing local cases. Use the normal local default plus individual transfers when you want local and transferred cases in the same case list. An unavailable Astra case stays identified as unavailable rather than being recreated locally.

## Optional scan interpretation

Configure this only when you need scans, handwriting, photographs, or map interpretation:

```sh
node dist/cli.js setup --client none --processing
```

For a client package, use its bundled runtime as described in [optional setup](distribution.md#optional-astra-and-scan-processing), keeping `--client none`. Setup requires an explicit provider choice. It offers OpenAI GPT-4.1 mini and Anthropic Haiku 4.5 presets, plus custom model settings. The presets carry prices verified on **October 1, 2026**, pinned model identifiers, and conservative token bounds. Presets expire after 90 days. Updating the date without checking prices is not a refresh. See the linked provider references in setup, or supply newly verified custom settings.

Enter the selected provider's API key securely outside chat. macOS uses Keychain. Windows encrypts saved credentials using DPAPI for the current Windows user. Client configuration and research exports do not contain these credentials. Native credential-store acceptance remains part of the platform checklist.

The selected provider receives the page or image content needed for requested interpretation. Research reasoning remains in the client. Providers are never switched silently. Missing keys, invalid settings, or stale prices disable optional interpretation while public-record and text research remain available.

### Processing budget and recovery

Before dispatch, a conservative reservation counts against the project's **$10 default cumulative processing cap**. This covers server-issued processing calls and excludes client subscriptions and database hosting. Completed pages survive interruption. A processing queue shows which pages are complete or need attention.

Unknown billing outcomes pause rather than automatically issue another paid request. Ask the client to inspect saved processing state first. Verify the actual provider charge before approving reconciliation, and separately approve any new billable attempt. Correct pricing or token-limit incidents before unblocking processing.

A hard exit may leave a reservation marked `reserved`. Stop every server or worker that could still send that request, verify billing, then explicitly attest that dispatch has stopped during reconciliation. The service records the operator statement and cannot independently prove that another process was stopped.

## Export, back up, and restore

A **dossier** is a readable Markdown, HTML, or structured JSON report. A **portable backup** includes the full project's originals, necessary derived images, citations, corrections, decisions, logs, and checksums. Ask for both when preserving a complete research record.

Backups use versioned JSON with a default serialized limit of 250 MiB. Credentials and machine-specific paths are removed from research metadata. Original evidence files retain their actual content, so they are not automatically redacted.

Restore validates references and asset hashes into a fresh destination, never silently overwriting an existing case. An incomplete destination cannot be used for ordinary research. To resume, repeat the same bundle, destination, and operation identifier. CLI users can use:

```sh
node dist/cli.js export PROJECT_ID html
node dist/cli.js backup PROJECT_ID
node dist/cli.js restore /absolute/path/to/backup.json NEW_PROJECT_ID RESTORE_OPERATION_ID
```

When the CLI operation ID is omitted, a stable identifier is derived from the destination and bundle. Repeating the same command resumes the same restore.

### Reuse across projects

Explicit reuse copies selected evidence and its dependencies with origin provenance. Copied claims return to proposed status because a conclusion approved for one question is not automatically approved for another. Research is never silently pooled across projects. Repeating an unchanged copy resumes the saved operation instead of creating duplicates.

## Setup and recovery

| What you see | What to do |
| --- | --- |
| The plugin is connected but research needs setup | Ask for setup status. If guided configuration is needed, run setup with `--client none`, then restart the client. |
| The client cannot find the server | Reinstall or enable its client package. For a guided/developer installation, confirm its runtime still exists and rerun setup for that client. |
| Optional credentials are locked or missing | Unlock the OS credential store or rerun the relevant guided setup. Local text research remains available. |
| Astra is unavailable | Check the saved connection. Do not create a replacement local copy of the remote case. |
| Another setup owns a settings lock | Close the other setup. Remove a leftover lock only after confirming no setup process is running. |
| An export link does not open | Use Finder or File Explorer at the printed export folder, or ask for the dossier in chat. |

For developer diagnostics, run `node dist/cli.js doctor`. The `serve` command reserves stdin/stdout for MCP messages. Do not type ordinary chat text into its terminal.

Advanced environment overrides are listed in [.env.example](../.env.example). The application does **not** automatically load `.env`. Explicit environment values override saved settings. Existing explicitly supplied Astra credentials preserve their legacy storage intent when no storage mode is set. `PK_STORAGE=astra` never silently falls back on a failed connection. `PK_STORAGE=memory` is temporary and is intended for demos or tests.

## Development and validation

```sh
npm run typecheck
npm run test:coverage
npm run build
npm run test:cli
```

On a supported native release target, also run `npm run release:package` and `npm run test:installer`. These build and test the installed artifact, including native document extraction and rendering. They do not complete desktop application acceptance.

[Validation](validation.md) separates automated, live-service, installed-artifact, desktop, and pilot evidence. [Client acceptance](client-acceptance.md) records the actual-client release gates. [Source coverage](source-coverage.md) documents sources, rights, and limits.

[Pilot materials](pilot.md) contain an unsent recruitment draft and evaluation protocol for five professional researchers. The provisional target is at least 25% median reduction in total research effort, with no critical evidence errors in reviewed dossiers. This remains a target, not a measured result.

[Apache License 2.0](../LICENSE) · [Privacy](privacy.md). Archival materials retain their own rights and attribution requirements.
