# Actual client acceptance checklist

Status: **not yet completed in the actual desktop applications**. Setup can test an actual stdio subprocess and its readiness response. That verifies the local server, not the client UI, permissions, or conversational behavior. No packaged researcher release has been published yet.

Record release version and artifact checksum, commit, client version, OS version, architecture, runtime version, date, operator, and evidence for each run. Keep macOS Apple Silicon, macOS Intel, and Windows x64 results separate. Leave untested items unchecked.

## Installation and credentials, per supported platform

| Target | Native packaged installation | Codex journey | Claude Desktop journey | OS credential store |
| --- | --- | --- | --- | --- |
| macOS Apple Silicon | Automated artifact checks available, manual clean installation pending | Pending | Pending | Pending |
| macOS Intel | Native CI configured, acceptance pending | Pending | Pending | Pending |
| Windows x64 | Native CI configured, acceptance pending | Pending | Pending | Pending |

- [ ] Run one release setup command from a clean installation without Node or Git already installed.
- [ ] Choose both clients and local storage without entering any credentials.
- [ ] Verify existing client settings and unrelated servers survive, with readable backups of changed files.
- [ ] Restart each client and confirm Plot & Kin connects. Record any required host confirmation or administrator restriction.
- [ ] Confirm the installed Codex research skill appears and Claude exposes the equivalent workflow prompts.
- [ ] Test paths with spaces and non-ASCII characters.
- [ ] Extract embedded PDF text and render a page using the bundled runtime and native dependencies.
- [ ] Rerun setup and upgrade the runtime while preserving settings, case history, and original files.
- [ ] Exercise interrupted download, bad checksum, and incomplete configuration. Confirm recovery instructions work.
- [ ] Save and retrieve an optional credential through macOS Keychain or Windows DPAPI. Confirm no token appears in chat, process arguments, client configuration, or exported research.
- [ ] Lock or remove an optional credential and confirm local saved work and setup help remain usable.

## First case in Codex

- [ ] Ask to get started, then select a real address or the visibly labeled fictional sample.
- [ ] Begin a persistent local case using only an address and research question, without an Astra account or model key.
- [ ] Execute a bounded DC public-source search, inspect the candidate, and retain source provenance and limitations.
- [ ] Review a proposed finding with its citation precision and supporting/opposing evidence.
- [ ] Approve the exact wording in chat and verify the reviewed revision and approval attestation.
- [ ] Save an HTML dossier, locate its named file, and read the dossier directly in chat.
- [ ] Restart the client, ask to continue by recognizable case name, and recover the evidence and next step.
- [ ] Create two similarly named cases and confirm the client asks which one is intended.

## The same case in Claude Desktop

- [ ] Confirm the same welcome actions and readable tool results.
- [ ] Open the saved local case created through Codex and inspect its evidence and review decisions.
- [ ] Complete the public-search, proposal, explicit-review, dossier, restart, and resume journey without copying IDs.
- [ ] Confirm source images or crops appear through MCP image results.
- [ ] Verify equivalent provenance, uncertainty, review status, and client-independent case history.

## Everyday research in both clients

- [ ] Import permitted material through supported content handoff or the printed import folder. Do not assume a chat attachment is server-readable.
- [ ] Inspect a source/page/region citation against the preserved original.
- [ ] Propose conflicting interpretations and leave both inspectable.
- [ ] Correct an approved finding's evidence and confirm it requires renewed review.
- [ ] Interrupt and resume a bounded run without losing sources, failures, dead ends, or budget accounting.
- [ ] Configure an explicitly chosen scan provider outside chat, inspect preset date and cost bounds, and explain where pages are sent.
- [ ] Complete a partial page batch, resume saved pages, and inspect extraction corrections.
- [ ] Exhaust a small test budget without an automatic paid retry or hidden cap increase.
- [ ] Exercise uncertain billing recovery with verified charges and separate retry approval.
- [ ] Confirm missing, invalid, or stale model settings leave text work available.
- [ ] Export Markdown, HTML, and JSON and inspect review labels and citations.

## Optional Astra and portability

- [ ] Connect Astra through guided setup without changing the active location of existing local cases.
- [ ] Verify only dedicated collections are initialized and unrelated collections remain untouched.
- [ ] Explicitly approve moving one case, verify the completed destination, and confirm the original remains a read-only local archive.
- [ ] Inspect transferred originals, citation anchors, alternatives, corrections, review history, logs, and processing budget.
- [ ] Interrupt a transfer and follow recovery without parallel active copies, lost originals, or paid retries.
- [ ] Make Astra unavailable and confirm unrelated local cases still work. The remote case must remain identified as unavailable.
- [ ] Back up a complete case, then restore into a fresh installation and project without the original chat.
- [ ] Confirm corrupt bundles fail before destination writes and existing projects are never overwritten.
- [ ] Interrupt restore and repeat the same bundle, destination, and operation identifier.
- [ ] Explicitly reuse evidence in another case and confirm origin provenance survives while copied conclusions become proposed.
- [ ] Inspect exported metadata for credentials and machine-specific paths.

## Researcher pilot

- [ ] Observe five professional researchers attempting setup and a first case without coaching.
- [ ] Record setup time, retries, help requests, verification, and correction effort. Include optional Astra setup and transfer effort separately.
- [ ] Report unassisted completion and time to the first cited result without implying that automated tests measure usability.
- [ ] Record every material limitation. Complete the original matched-case pilot separately before claiming research-effort improvement.
