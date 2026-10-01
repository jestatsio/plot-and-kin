# Plot & Kin

**The history of places. The lives behind them.**

A local Codex plugin and MCP server for evidence-backed property research. Start with an address and research question, assemble archival sources, review competing explanations, and export a dossier that another researcher can inspect and reuse.

The first locality is Washington, DC. The initial users are professional researchers producing property histories. This is an Apache-2.0 prototype. Paid hosting is a later possibility, and no hosted service or web application is included.

## What the prototype does

- Keeps sources, passages, people and places, proposed claims, decisions, research gaps, and search history in a researcher-owned Astra database.
- Stores original files and derived images in a local, content-addressed library. Citations retain document, page, passage, or image-region precision where available.
- Supports local documents and the selected DC public sources. Handwriting and maps may be read and cited without implying certainty or providing GIS analysis.
- Preserves opposing evidence and alternative interpretations. Identity merges and conclusions require explicit review in the client conversation.
- Exports Markdown, escaped static HTML, and structured JSON. A separate versioned JSON backup includes original and derived assets and can be restored into a fresh project.
- Builds a chronological claim timeline while retaining original date qualifiers, category, and review state. Ambiguous dates remain unplaced, and undated claims remain visible.
- Provides the same stdio MCP service to Codex and Claude Desktop. The client conducts the conversation and investigation. There is no remote agent daemon.

## Install from this checkout

Use Node.js 22.19 or later.

```sh
npm ci
npm run build
npm test
```

Set these variables in the environment of the process that launches the server:

| Variable | Purpose |
| --- | --- |
| `ASTRA_DB_API_ENDPOINT` | Endpoint of your Astra database |
| `ASTRA_DB_APPLICATION_TOKEN` | Your Astra application token |
| `ASTRA_DB_KEYSPACE` | Keyspace, default `default_keyspace` |
| `PK_LIBRARY_DIR` | Local library, default `~/.plot-and-kin` |
| `PK_IMPORT_DIR` | Allowed local upload directory, default the library's `imports` directory |

The default storage mode is Astra. Initialization creates only Plot & Kin's `pk_*` collections. It does not migrate or reuse unrelated collections. Keep credentials in local environment configuration, outside Git and research records.

```sh
node dist/cli.js init
node dist/cli.js doctor
node dist/cli.js serve
```

`serve` uses stdin/stdout for MCP messages. Do not paste ordinary chat text into that terminal. Diagnostics belong on stderr.

`PK_STORAGE=memory` is an explicit temporary demo/test mode. Its records disappear when the process ends. It is unsuitable for real research unless the project is backed up before exit.

For a synthetic demonstration with no external services, run `node dist/cli.js demo`. It writes inspectable exports and exercises a backup/restore round trip. Its invented source is explicitly labeled, and the demo does not manufacture a human approval.

## Connect a client

Codex and Claude Desktop must launch the built server with an absolute path. Set the same Astra and library environment in each client so both can access the same research. GUI applications do not necessarily inherit terminal environment variables.

For Codex, the local plugin metadata is in `.codex-plugin/plugin.json`, which points to `skills/` and `mcp.json`. Build the checkout before loading it as a local plugin. Its MCP entry uses the plugin's `${PLUGIN_ROOT}` expansion. A direct MCP configuration is also possible:

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

For Claude Desktop, add an MCP entry to its local configuration:

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

The repository's `.mcp.json` uses `${CLAUDE_PLUGIN_ROOT}` for plugin-aware clients. That variable is not a substitute for the absolute path in an ordinary Claude Desktop configuration. Desktop installation and conversational acceptance are separate manual checks in [the client checklist](docs/client-acceptance.md).

## Optional document processing

Embedded text import and evidence review do not require a model API key. Model-assisted processing uses an explicitly selected OpenAI or Anthropic adapter and the researcher's key:

| Variable | Purpose |
| --- | --- |
| `PK_PROVIDER` | `openai` or `anthropic` |
| `PK_MODEL` | Model identifier supported by the selected provider |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Key for the selected provider |
| `PK_INPUT_USD_PER_MILLION` | Current input price for the configured model |
| `PK_OUTPUT_USD_PER_MILLION` | Current output price for the configured model |
| `PK_PRICING_DATE` | Price verification date in `YYYY-MM-DD`, no more than 90 days old |
| `PK_MAX_INPUT_TOKENS` | Conservative input-token bound for the configured model/request |

Model IDs and prices are not hardcoded. Set them using your provider's current documentation before making billable calls. Processing reserves a conservative cost before dispatch against the project's **$10 default cap**. The cap covers server-issued processing requests. It excludes Codex/Claude client charges, subscriptions, and Astra hosting. A failed request with an unknown billing outcome does not trigger an automatic billable retry.

Inspect saved processing state first. `page_process` resumes an already saved result without another model request. If no usable result exists, verify actual provider billing and record it with `budget_reconcile`. A new billable attempt requires separate explicit approval through `page_retry`. Resolve any processing incident and correct its pricing/token limits before using `processing_unblock`.

A hard process exit may leave a reservation marked `reserved`. Before reconciling that state, stop every server or worker that could still send the original request, check provider billing, then attest `dispatchStopped: true` in `budget_reconcile` from the restarted server. This is a recorded operator confirmation. The service cannot independently establish that another process was stopped.

The service runs locally, but Astra stores project records and the selected model provider receives the content required for the processing you request. Originals remain in the local library. See [data and evidence handling](docs/evidence-and-data.md).

## A research session

1. Start a project with a DC address, a question, known information, and any source restrictions.
2. Agree a bounded research run in the client. Search selected public sources and import permitted documents from your import directory.
3. Inspect extracted passages against the originals. Correct errors while retaining the earlier transcription and its provenance.
4. Draft claims with supporting and opposing passage references. Keep unresolved identities separate.
5. Review conclusions and proposed identity merges in chat. Record the approval against the exact target revision.
6. Export the dossier. Make a portable backup to preserve originals, derived assets, evidence, decisions, and logs together.

An address match proposes a lead. Ownership does not establish occupancy, a building's appearance on a map does not establish its construction date, and a search with no results does not establish absence.

## Portability and cross-project reuse

The dossier is a reviewable report. The backup is a self-contained `plot-and-kin` schema-version-1 JSON bundle with base64 asset bytes and SHA-256 hashes. The default serialized bundle limit is 250 MiB. Runtime credentials and absolute machine paths are excluded from record metadata.

```sh
node dist/cli.js export PROJECT_ID markdown
node dist/cli.js export PROJECT_ID html
node dist/cli.js export PROJECT_ID json
node dist/cli.js backup PROJECT_ID
node dist/cli.js restore /absolute/path/to/backup.json NEW_PROJECT_ID RESTORE_OPERATION_ID
```

Exports are written under the configured library's `exports` directory. Use the same explicit restore operation ID when resuming an interrupted restore. When the CLI operation ID is omitted, it derives a stable ID from the destination and bundle, so repeating the same command resumes the same restore.

Restoration requires a fresh destination project and validates the complete bundle, references, and asset hashes before writing. If interrupted, repeat the same bundle, destination, and operation identifier. The destination remains unavailable for research until restoration is ready. Existing projects are never silently overwritten.

Explicit reuse copies selected sources, passages, entities, or claims together with their evidence dependencies into another ready project in the same library. It records origin provenance and resets copied claim/entity approvals to proposed. Research is not automatically pooled across projects.

Repeated copies of an unchanged selection use deterministic operation and record IDs. An interrupted copy resumes with dependency checks and retained progress instead of creating duplicates. Changing the source snapshots creates a new default operation. An explicitly reused operation ID rejects different inputs. Processing jobs are not copied as evidence, but their origin is retained on copied passages.

## Development and pilot

```sh
npm run typecheck
npm test
npm run build
```

[Pilot materials](docs/pilot.md) contain an unsent recruitment draft, permissions checklist, and a counterbalanced measurement protocol. The target is at least 25% median paired reduction in total research time, including checking and corrections, with no critical evidence errors in the reviewed dossiers. This target is not a measured result.

[Source coverage](docs/source-coverage.md) distinguishes verified public-source capabilities, compiled leads, fixture provenance, and known gaps. [Desktop acceptance](docs/client-acceptance.md) must be completed in the actual clients before claiming they passed.

[Validation results](docs/validation.md) record the automated and live checks, plus the remaining acceptance work.

The software uses the [Apache License 2.0](LICENSE). Archival materials retain their own rights and attribution requirements.
