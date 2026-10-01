# Evidence and data handling

## Research records

Projects begin with an address and a question. Sources describe provenance, retrieval, rights, and local asset references. Passages retain their source and the most precise available locator. Entities represent people, places, and organizations without assuming that similarly named records describe the same subject.

Claims contain a statement and supporting or opposing passage references. Claims move through proposed, accepted, rejected, and requires-review states. Proposed identity merges are reviewed claims. They do not destructively collapse entities.

Corrections add a superseding passage and retain the earlier version. A conclusion citing a superseded passage requires renewed review. Dossier rendering enforces this even when a concurrent write left the stored status accepted.

Review decisions preserve the target revision, reviewer label, approval wording, and a snapshot. The client submits the attestation after the human approves in chat. The MCP server cannot independently authenticate the human conversation. It must never infer approval from a request to write a report.

## Where data goes

| Location | Contents |
| --- | --- |
| Local SQLite database, by default | Persistent project state, passages, claims, decisions, logs, budget state, and transfer locations |
| Researcher's Astra database, if selected | Structured research in dedicated `pk_*` collections for transferred cases or an explicitly chosen Astra default |
| Local library | Content-addressed original and derived asset bytes, import directory, and exported files |
| Selected OpenAI or Anthropic API | The material supplied for an explicitly requested processing operation |
| Codex or Claude client | The conversation and MCP results requested by that client |

No provider fallback is implicit. No provider key is embedded in a project or export. Nonsecret setup preferences live outside replaceable runtime directories. macOS Keychain and Windows DPAPI protect saved credentials. Client registration contains a settings-directory reference rather than tokens. Explicit environment overrides remain available for advanced deployments.

Local cases persist across restarts and use transactional revision checks and idempotency rules. Codex and Claude Desktop can access the same library concurrently. Model configuration is optional and cannot make public-record or text research depend on a model key.

Before importing third-party records, establish permission for possession, processing, retention, and the intended export. Public access does not itself establish redistribution rights. Source-specific restrictions must travel with source metadata and constrain the research run.

## Budgets and interrupted work

The default processing budget is $10 per project. It covers server-issued document-processing calls. Client/model-chat charges and Astra costs are outside this accounting. A conservative reservation is recorded before a provider call. Unknown provider outcomes retain conservative budget accounting and require a deliberate recovery decision instead of an automatic paid retry.

Run logs distinguish successful searches, zero-result searches, inaccessible sources, partial results, errors, and paused work. An upstream error cannot support a claim that a source contains no matching record.

Resume saved page results with `page_process`. Use `budget_reconcile` only after verifying the prior charge. A new `page_retry` is a separate, explicitly approved action. If a processing incident blocked the project, correct the underlying configuration and record its resolution with `processing_unblock` before proceeding.

## Backup and restore

Version 1 bundles include all project records, original and derived assets, and checksums. Runtime secrets and absolute machine paths are removed from record metadata. Original files are preserved as evidence, so their own content is not rewritten or redacted automatically.

Restore validates the bundle before writes, checks every referenced asset, remaps local record IDs into a fresh project, and retains historical review snapshots. The restore operation becomes complete before the project becomes ready. A crash between these steps is recoverable by replaying the same bundle and operation ID. An incomplete project cannot be used for ordinary research.

Explicit reuse inside the same library copies a selected record and its evidence dependencies. It preserves source-project IDs as origin metadata. It resets review approval because a conclusion appropriate to one research question is not automatically approved for another.

Copy operations retain an input fingerprint, deterministic output IDs, and progress. Repeating an unchanged request resumes the same operation. Dependencies are written before claims and completion requires every referenced record. Processing-job links remain in origin provenance rather than importing jobs into the new project. Restore remaps saved processing links, retry chains, and budget reservations, including approved attempts that have not yet been dispatched.

## Moving a case to Astra

Connecting Astra records an optional connection without moving local cases. An explicit case transfer takes a consistent snapshot and prevents competing source writes while it verifies the destination. It checks the evidence graph and asset hashes, preserves review snapshots, alternatives, corrections, research logs, and consumed or reserved processing budget, then records the new active location.

The original local case remains a read-only archive after success. Original and derived document bytes remain in the local library. There is no automatic synchronization, shared-account feature, or cloud document backup.

A failed or interrupted transfer is a saved operation. Resume the same operation, or follow its cancellation/recovery instructions after confirming the previous process has stopped. A destination awaiting verification is unavailable for ordinary research. An unavailable Astra case is identified as unavailable rather than silently recreated locally. Uncertain billing remains uncertain in the transferred case.
