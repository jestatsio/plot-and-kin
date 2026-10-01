# Getting started

**Last updated: October 1, 2026**

Plot & Kin is a local MCP server for property-history research in Codex and Claude Desktop. Research records live in your Astra database. Original documents and derived images live in your local library. Optional model processing uses your chosen provider and credentials.

[Project overview](../README.md) · [Documentation site](https://jestatsio.github.io/plot-and-kin/) · [Evidence and data](evidence-and-data.md) · [Validation](validation.md)

## 1. Build and try the demo

Install Node.js **22.19 or later** and npm, then clone and build the project:

```sh
git clone https://github.com/jestatsio/plot-and-kin.git
cd plot-and-kin
npm ci
npm run build
node dist/cli.js demo
```

The demo needs no Astra credentials or model API key. It creates an explicitly fictional case, writes Markdown and HTML dossiers plus a portable backup, and exercises a backup/restore round trip. Its JSON output gives you the export paths. Open the HTML file in a browser to inspect the report.

The demo uses temporary in-memory records. Its exported files persist, but the research records disappear when the process ends. It never fabricates a human approval.

To choose where demo artifacts are written:

```sh
PK_LIBRARY_DIR="$PWD/.plot-and-kin-demo" node dist/cli.js demo
```

## 2. Configure persistent storage

Set these variables in the environment of the process that launches the server. The [.env.example](../.env.example) file lists the configuration. The application does **not** automatically load a `.env` file.

| Variable | Purpose |
| --- | --- |
| `ASTRA_DB_API_ENDPOINT` | Endpoint of your Astra database |
| `ASTRA_DB_APPLICATION_TOKEN` | Your Astra application token |
| `ASTRA_DB_KEYSPACE` | Keyspace, default `default_keyspace` |
| `PK_LIBRARY_DIR` | Local library, default `~/.plot-and-kin` |
| `PK_IMPORT_DIR` | Allowed local upload directory, default the library's `imports` directory |

Use absolute library and import paths in desktop-client configurations. Keep credentials in local environment configuration, outside Git and research records.

Initialize the dedicated collections and check the configuration:

```sh
node dist/cli.js init
node dist/cli.js doctor
```

Initialization creates only `pk_records` and `pk_passages`. It does not migrate or reuse unrelated collections. The setup check verifies Astra lexical search support, which is a preview capability. See [validation](validation.md) for the live capability check and its limits. Dependency versions are pinned in [package.json](../package.json) and the lockfile.

The default storage mode is Astra. `PK_STORAGE=memory` is an explicit temporary demo/test mode. It is unsuitable for persistent research unless you back up the project before exit.

## 3. Connect Codex or Claude Desktop

Both clients use the same stdio MCP server and research tools. Set the same Astra and library environment in each client to access the same research. GUI applications do not necessarily inherit terminal environment variables.

Build the checkout before connecting a client. Each configuration below must point to its actual absolute path. If your desktop application cannot find `node`, use the absolute path to your Node executable as `command`.

### Codex

The local plugin metadata in [.codex-plugin/plugin.json](../.codex-plugin/plugin.json) points to the workflow skill and [mcp.json](../mcp.json). Its MCP entry uses the plugin's `${PLUGIN_ROOT}` expansion.

You can also configure the MCP server directly:

```toml
[mcp_servers.plot-and-kin]
command = "node"
args = ["/absolute/path/to/plot-and-kin/dist/cli.js", "serve"]

[mcp_servers.plot-and-kin.env]
ASTRA_DB_API_ENDPOINT = "https://YOUR-DATABASE-ENDPOINT"
ASTRA_DB_APPLICATION_TOKEN = "YOUR-LOCAL-TOKEN"
ASTRA_DB_KEYSPACE = "default_keyspace"
PK_LIBRARY_DIR = "/absolute/path/to/your/plot-and-kin-library"
```

The [research workflow skill](../skills/research-property/SKILL.md) guides bounded investigation, evidence handling, and review.

### Claude Desktop

Add an MCP entry to Claude Desktop's local configuration:

```json
{
  "mcpServers": {
    "plot-and-kin": {
      "command": "node",
      "args": ["/absolute/path/to/plot-and-kin/dist/cli.js", "serve"],
      "env": {
        "ASTRA_DB_API_ENDPOINT": "https://YOUR-DATABASE-ENDPOINT",
        "ASTRA_DB_APPLICATION_TOKEN": "YOUR-LOCAL-TOKEN",
        "ASTRA_DB_KEYSPACE": "default_keyspace",
        "PK_LIBRARY_DIR": "/absolute/path/to/your/plot-and-kin-library"
      }
    }
  }
}
```

The repository's [.mcp.json](../.mcp.json) uses `${CLAUDE_PLUGIN_ROOT}` for plugin-aware clients. Use an absolute path in an ordinary Claude Desktop configuration. The server exposes `property_history` and `review_dossier` MCP prompts as well as its tools.

To start the server manually for protocol inspection:

```sh
node dist/cli.js serve
```

`serve` reserves stdin/stdout for MCP messages. Do not paste ordinary chat text into that terminal. Diagnostics use stderr.

Actual installation and conversational acceptance in both desktop applications remain manual checks in [the client checklist](client-acceptance.md). Passing SDK and subprocess tests does not establish host application acceptance.

## 4. Run a research session

A useful opening request in either client is:

> Create a Plot & Kin project for 1920 Rosedale Street NE, Washington, DC. Investigate what the available building records say about its early construction history. Start with the public DC sources, preserve uncertainty, and bring proposed conclusions to me for review.

This is a suggested research request, not a claim about the property.

1. **Define the question.** Capture the address, known information, source restrictions, and intended output.
2. **Start a bounded run.** The default run allows 30 minutes, 25 external searches, and 50 processed pages. Progress remains available when a limit stops research operations.
3. **Acquire evidence.** Search the selected public sources or import permitted documents from your import directory. Subscription material enters through permitted manual imports.
4. **Inspect and correct.** Compare passages with originals. Corrections retain the earlier extraction and its provenance.
5. **Propose and review.** Link claims to supporting and opposing evidence. Review conclusions and ambiguous identity merges in chat against the exact target revision.
6. **Export and continue.** Create a dossier for review and a portable backup for preserving the full project. Resume from saved searches, gaps, and next steps.

An address match proposes a lead. Ownership does not establish occupancy. A building's appearance on a map does not establish its construction date. A search with no results does not establish absence.

Review is an audited workflow convention. The service records the stated reviewer, decision, and reviewed version. It does not independently authenticate that a human made the decision.

## 5. Enable optional document processing

Embedded-text import and evidence review do not require a model API key. For scanned pages, handwriting, photographs, and map interpretation, select an OpenAI or Anthropic adapter and supply your own key:

| Variable | Purpose |
| --- | --- |
| `PK_PROVIDER` | `openai` or `anthropic` |
| `PK_MODEL` | Model identifier supported by the selected provider |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Key for the selected provider |
| `PK_INPUT_USD_PER_MILLION` | Current input price for the configured model |
| `PK_OUTPUT_USD_PER_MILLION` | Current output price for the configured model |
| `PK_PRICING_DATE` | Price verification date in `YYYY-MM-DD`, no more than 90 days old |
| `PK_MAX_INPUT_TOKENS` | Conservative input-token bound for the configured model/request |

Add these variables to the server environment in your client configuration. Model IDs and prices are not hardcoded. Verify them in your chosen provider's current documentation before making billable calls. Providers are never switched silently.

The client conducts the research and reasoning. Server-issued model calls handle document extraction and image interpretation. The selected provider receives the content needed for those requests, while originals remain in the local library. See [evidence and data handling](evidence-and-data.md).

### Processing budget and recovery

Processing reserves a conservative cost before dispatch against the project's **$10 default cumulative cap**. The cap covers server-issued processing requests. It excludes Codex/Claude client charges, subscriptions, and Astra hosting. The software can record explicitly authorized budget changes.

A request with an unknown billing outcome does not trigger an automatic billable retry:

- Inspect saved processing state first. `page_process` resumes an already saved result without another model request.
- If no usable result exists, verify actual provider billing and record it with `budget_reconcile`.
- A new billable attempt requires separate explicit approval through `page_retry`.
- Resolve any processing incident and correct its pricing/token limits before using `processing_unblock`.

A hard process exit may leave a reservation marked `reserved`. Before reconciling that state, stop every server or worker that could still send the original request, check provider billing, then attest `dispatchStopped: true` in `budget_reconcile` from the restarted server. This is a recorded operator confirmation. The service cannot independently establish that another process was stopped.

## 6. Export, back up, and restore

A **dossier** is a reviewable Markdown, static HTML, or structured JSON report. A **backup** is a self-contained, schema-version-1 JSON bundle containing records, originals, necessary derived assets, and SHA-256 hashes. The default serialized bundle limit is 250 MiB. Runtime credentials and absolute machine paths are excluded from record metadata.

```sh
node dist/cli.js export PROJECT_ID markdown
node dist/cli.js export PROJECT_ID html
node dist/cli.js export PROJECT_ID json
node dist/cli.js backup PROJECT_ID
node dist/cli.js restore /absolute/path/to/backup.json NEW_PROJECT_ID RESTORE_OPERATION_ID
```

Exports are written under the configured library's `exports` directory. Retain both the dossier and backup when sharing a complete research record.

Restoration validates the complete bundle, references, and asset hashes before writing. It requires a fresh destination project and never silently overwrites an existing one. An interrupted destination remains unavailable for research until restoration is ready.

To resume an interrupted restore, repeat the same bundle, destination, and operation identifier. When the CLI operation ID is omitted, it derives a stable ID from the destination and bundle, so repeating the same command resumes the same restore.

### Reuse across projects

Explicit reuse copies selected sources, passages, entities, or claims together with their evidence dependencies into another ready project in the same library. It records origin provenance and resets copied claim/entity approvals to proposed. Research is not automatically pooled across projects.

Repeated copies of an unchanged selection use deterministic operation and record IDs. An interrupted copy resumes with dependency checks and retained progress instead of creating duplicates. Changing the source snapshots creates a new default operation. An explicitly reused operation ID rejects different inputs. Processing jobs are not copied as evidence, but their origin is retained on copied passages.

## Development and validation

```sh
npm run typecheck
npm run test:coverage
npm run build
npm run test:cli
```

[Validation results](validation.md) record automated and live checks, plus outstanding acceptance work. [Source coverage](source-coverage.md) distinguishes compiled leads, archival evidence, fixture provenance, and known gaps.

[Pilot materials](pilot.md) contain an unsent recruitment draft and a counterbalanced measurement protocol for five professional researchers. The provisional target is at least 25% median reduction in total research effort, including verification and corrections, with no critical evidence errors in reviewed dossiers. This is a target, not a measured result.

The software uses the [Apache License 2.0](../LICENSE). Archival materials retain their own rights and attribution requirements.
