# From installation to a first research case

Status: implementation plan updated with the researcher's onboarding decisions on October 1, 2026. This document plans the work and does not claim that these installation flows already exist.

## The outcome

A researcher installs Plot & Kin, asks about an address, inspects one cited finding, saves a dossier, and returns to the same case tomorrow.

Codex and Claude Desktop should offer the same research journey, with installation and credential entry adapted to each client's supported capabilities. The primary instructions should speak in terms of addresses, cases, sources, and findings. A researcher should never need to understand MCP, copy record IDs, build source code, or troubleshoot a stack trace to complete that journey.

The first complete journey uses DC public records and text documents with durable local storage. It requires no Astra account or separate OpenAI or Anthropic processing key. The client's own subscription remains separate. Researchers who choose Astra use their own database and account.

## Agreed direction

| Decision | Selected direction | Consequence |
| --- | --- | --- |
| Installation expectation | One copy-and-paste setup command. | Provide a tested command for each supported OS that launches guided setup. No source checkout, manual dependency build, or configuration-file editing. |
| Account requirement | Local storage is the simple default. Guided Astra setup is optional. | Real saved research works before account creation. This deliberately expands the original Astra-only storage architecture. |
| Supported systems | Work toward macOS and Windows together, prioritizing macOS. | Develop and test both paths in parallel. A Windows-specific blocker may defer the Windows release, with its status clearly labeled. Both clients remain required on each released platform. |

The initial setup recommends “Save on this computer.” It creates the research database and document library with sensible defaults, explains where they live, and offers “Connect Astra” as an optional path available during setup or later. Local mode is a complete storage option with the same evidence, review, and budget rules, not a temporary sample mode. It does not make external source retrieval or model interpretation available offline.

Use a durable local database behind the existing storage interface. SQLite is the proposed implementation, subject to a focused compatibility check with the packaged runtime. Include transactional revisions, idempotency, lexical retrieval, schema migrations, and restoration tests. Records and source files must survive process exit, crashes, upgrades, and simultaneous use by Codex and Claude Desktop.

The optional Astra flow guides account and database setup, securely accepts credentials outside chat, initializes only the dedicated collections, and verifies capability compatibility. Explain that structured records move to the researcher's Astra database while original documents remain in the local library. Connecting Astra alone is not a cloud backup of the document library.

Moving an existing case to Astra is an explicit, verified transfer. Preserve its evidence, citation anchors, corrections, approvals, logs, assets, and consumed or reserved processing budget. Use a consistent snapshot and prevent conflicting writes during the transfer. Keep the local source intact until verification completes, and switch the active location only after success. An uncertain paid operation remains uncertain after transfer. Failed transfers leave the original case usable and can resume safely. Do not automatically synchronize or write changes to both locations.

## What the audit found

- MCP startup currently waits for strict configuration, provider construction, and Astra diagnostics. A setup failure prevents the user from accessing help through the plugin.
- Optional model configuration can prevent public-record and text-document work. It must become an independent capability.
- Installation currently requires a source checkout, Node, a build, environment variables, and manual client configuration. The repository has no tested desktop release bundle.
- The current sample runs from the CLI and uses temporary records. It is not an in-chat first-use path.
- Tool results expose structured JSON without a parallel researcher-friendly presentation. Imports and exports rely on technical file paths.
- The actual Codex and Claude Desktop acceptance checklist remains open. Passing protocol and domain tests does not close that gap.

The evidence, review, cost accounting, and portability services provide the foundation. Most of this milestone concerns distribution, setup, presentation, and recovery.

## The intended journey

1. **Run one command.** The website provides a tested macOS or Windows setup command and its prerequisites. Setup detects available clients and lets the researcher choose Codex, Claude Desktop, or both.
2. **Use the simple default.** “Save on this computer” initializes persistent storage and the document library without credentials. “Connect Astra” opens the optional guided flow. Explain where records and files live.
3. **Confirm connection.** Setup explains any required client restart. The installed plugin responds with a welcome and readiness summary. Verify connection in each selected client, and keep help available if setup is incomplete.
4. **Choose an action.** “Research an address,” “Continue a case,” or “Explore a sample.” Sample material is visibly labeled throughout.
5. **Describe the case.** Ask for an address and research question. Offer a suggested question when needed. Gather known facts and source restrictions progressively.
6. **Confirm the starting point.** Present candidate addresses when ambiguous, the DC source coverage, and the research limits. Do not treat a match as an established historical identity.
7. **Show useful evidence.** Retrieve a public record and present a proposed finding alongside its source, citation precision, and limitations. Keep compiled information distinct from original archival evidence.
8. **Review the wording.** Offer “Approve,” “Revise,” or “Leave unresolved” conversationally. Record explicit approval of the exact reviewed version. These are intended actions, not a dependency on clients rendering custom buttons.
9. **Keep the result.** Show the dossier in chat, provide a verified route to a named export, and explain how to find the saved case later.
10. **Resume tomorrow.** After restarting the client, selecting the recognizable case brings back its question, evidence, review queue, and next useful step.

## Delivery sequence

### 1. Prove installation in both clients

Build a one-command bootstrap for macOS and Windows that installs a versioned release, provides its compatible runtime and native dependencies, and launches guided configuration. Do not require researchers to install Node or Git separately. Start by proving a setup-capable MCP server on a clean supported machine in actual Codex and Claude Desktop.

The command should detect available clients, ask which to connect, preserve existing client settings and other MCP servers, and record installation state outside the plugin cache. Use supported registration mechanisms and explain any required host confirmation or restart. Rerunning setup should repair or update the installation safely. Verify downloaded artifacts before use and give an actionable retry path when downloading or installation fails. Publish the actual commands only after this path works.

For Claude Desktop, investigate an MCP bundle (`.mcpb`) with a manifest, packaged dependencies, and secure configuration fields. Claude documents a bundled Node runtime, but compatibility with Plot & Kin's minimum Node version and native dependencies must be demonstrated. See [Anthropic's desktop extension guide](https://www.anthropic.com/engineering/desktop-extensions).

For Codex, test the supported local/custom marketplace route and a packaged runtime. The installed plugin runs from a cache rather than the development checkout. npm-based distribution still requires npm and does not run installation lifecycle scripts. Public directory submission is a separate gate: the current documentation directs MCP submissions toward remote HTTPS and asks local servers to contact OpenAI. A public directory listing is therefore not a prerequisite or promise for this local prototype. See [Codex plugin packaging](https://developers.openai.com/plugins/build/plugins).

Do not assume Claude's installation prompts are portable. OpenAI plugins do not run Claude `userConfig` prompts or expand their values. The accepted one-command setup allows a shared guided terminal flow, including masked credential entry outside chat and secure persistence. Verify a suitable credential store on each supported OS. Prefer native client forms when useful, without requiring a new setup web application. See [OpenAI's migration guidance](https://developers.openai.com/plugins/guides/submit-claude-plugin#replace-claude-userconfig).

Acceptance:

- One command launches guided installation and ends with a verified connection in each selected client, including any required restart or host confirmation.
- Installation does not require a repository checkout, separate Node/Git installation, compiling dependencies, or manual client configuration edits.
- Existing client configuration survives setup. Repeated setup and upgrades preserve settings, cases, and the document library.
- The installed artifact can extract text from a PDF and render a page with the bundled native dependencies and runtime assets.
- Library and settings locations are separate from replaceable plugin caches.
- The release matrix records client versions, OS versions, processor architectures, runtime requirements, and any account or administrator restrictions.
- Installed-artifact tests cover paths with spaces and non-ASCII characters, credential persistence, and native dependency loading on each supported OS.
- macOS and Windows work proceeds in parallel. Release Windows only after it passes the same actual-client journey. Document any blocker that defers it while macOS ships first.

### 2. Make setup recoverable and local research persistent

Introduce a lightweight bootstrap that connects to MCP before the research application is ready. It always exposes welcome, setup status, and help. Load optional provider and document-rendering dependencies only when needed.

Report capabilities separately: storage, local library, public sources, text reading, and optional scan interpretation. Each incomplete capability has a specific next action and a way to check again. Source availability checks should be bounded and must not prevent access to saved work.

Add a settings service that separates nonsecret preferences from credential handling. Implement local persistence as the default, with automatic first-run initialization. Add the optional guided Astra connection and explicit case-transfer flow. Store the active location explicitly so clients do not silently switch backends on failure. Show the library location clearly and retain the restricted file-access boundary.

Acceptance:

- A new local installation can create, search, review, export, and resume a real case without database credentials.
- Missing credentials and unavailable Astra do not block local cases, setup, or help. An unavailable Astra case remains identified as unavailable rather than being silently recreated locally.
- Missing, invalid, or stale model configuration disables paid interpretation only.
- Researchers are never instructed to paste tokens into chat or edit JSON/TOML files on the primary path.
- Setup retries are safe, and initialization leaves unrelated collections untouched.
- Local storage passes restart and crash-recovery tests, concurrent-client revision checks, idempotent retry tests, lexical retrieval, and backup/restore with the same evidence and budget semantics as Astra.
- Case transfer verifies references and checksums before switching the active location. Failure leaves the source usable. Approved findings, alternative interpretations, review history, and budget state survive the transfer.

### 3. Complete one real case

Update the Codex skill and equivalent Claude prompts around the intended journey. Add an in-chat sample, readable tool summaries, case selection by address/title, and concise next actions. Keep explicit project identifiers in the protocol while resolving user-friendly names safely. Ask for clarification when multiple cases match.

Use one DC public-source case to prove the entire path: address and question, candidate examination, cited proposal, explicit review, dossier, restart, and resume. Defer model setup until a document actually requires interpretation.

Acceptance:

- Both clients complete the same journey without copying internal IDs or invoking raw tool names.
- Findings display support, opposition when present, and citation limitations before approval.
- Proposed findings, approved conclusions, and unresolved questions remain distinct.
- Case history survives restart and is usable independently of the originating chat.
- A failed or empty search is explained and retained without becoming evidence of absence.

### 4. Make everyday work clear

Add a case summary with the research question, saved progress, accepted conclusions, pending review, contradictions, and next steps. Present document processing as a resumable queue with completed pages and pages needing attention.

Verify file handling separately in each client. A chat attachment is not automatically accessible to a local MCP server. Prefer an explicit supported file handoff, with a clearly explained import folder as a fallback. Apply the same approach to backup restoration. Keep the in-chat dossier as the baseline when a client cannot open a local export.

For scans, offer explicit provider/model selection, maintained pricing presets, a cost estimate, remaining budget, and a clear explanation of which service receives the content. Never silently change providers. Preserve the existing reservation and uncertain-billing safeguards.

Translate map requests into a proposed location and excerpt extent that the researcher can examine. Technical bounding-box values should not be a prerequisite for asking to inspect a map.

Acceptance:

- A researcher can import a document, review and correct extraction, and export a recognizably named dossier.
- Budget exhaustion, interruption, and uncertain billing have plain-language recovery paths.
- “Dossier” and “Portable backup” have distinct purposes and reliable opening or saving instructions.
- Reinstalling or upgrading the plugin preserves cases and the document library.

### 5. Validate and publish the experience

Run the installed journey on clean supported systems in both actual clients. Cover the account-free local path first, then optional Astra setup and case transfer. Add automated tests for bootstrap states, capability isolation, configuration migration, release contents, local storage parity, and restart recovery. Keep real-client acceptance as a separate release gate.

Then ask five professional researchers to attempt installation and a first case without coaching. Observe where help is needed before editing the instructions again. Publish screenshots and a short walkthrough captured from the tested release, with client versions and sample labels.

Proposed release targets:

| Measure | Target |
| --- | --- |
| Unassisted first-case completion | At least four of five pilot researchers, with every failure documented |
| Ready-to-first-cited-result time | Median five minutes or less on the designated introductory case |
| Total setup effort | Report from the setup command through the first useful result, including retries and assistance. Measure optional Astra account setup and transfer separately, including their full effort |
| Developer knowledge required | One setup command with guided prompts, no source build, configuration-file edits, copied IDs, or unexplained protocol terms on the primary path |
| Evidence integrity | No fabricated approvals, misleading citations, unsupported accepted claims, or incorrect identity merges |
| Continuity | Case survives client restart, plugin upgrade, and tested backup/restore |

These targets evaluate onboarding. They do not replace the original matched-case research-effort pilot or establish market demand.

## Implementation map

| Area | Expected changes |
| --- | --- |
| Release packaging and CI | Client manifests, release artifacts, dependency packaging, supported-platform checks, installed-artifact smoke tests |
| `src/cli.ts`, `src/config.ts` | Setup-capable startup, settings lifecycle, partial configuration |
| `src/application.ts`, `src/providers.ts`, `src/documents.ts` | Capability isolation, deferred optional dependencies, actionable status |
| `src/server.ts` | Onboarding/status tools, readable responses alongside structured results, sample and case navigation |
| Storage and library services | Durable local database, local/Astra parity, guided initialization, explicit verified transfers, stable data locations |
| `skills/research-property/SKILL.md` and MCP prompts | Welcome, first-case, review, resume, and recovery behavior |
| Website and getting-started guide | Client-specific install paths, progressive setup, verified screenshots |
| `docs/client-acceptance.md` and pilot materials | Clean-install matrix, complete desktop journeys, measured onboarding effort |

## Scope boundaries

This milestone retains professional research, DC starting coverage, explicit evidence review, bounded research, the project processing budget, and portable history. It does not add a hosted service, subscription billing, shared workspaces, a standalone research web application, or nationwide coverage.

Durable local storage is the approved addition to the original architecture. Astra remains an optional storage backend. Automatic synchronization and cloud document backups remain outside scope.

The first implementation increment is installation plus recoverable readiness in both clients. The first researcher-facing milestone is the complete public-record case, including restart and resume.
