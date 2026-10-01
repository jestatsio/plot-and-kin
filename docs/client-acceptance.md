# Actual client acceptance checklist

Status: **not yet run in the actual desktop clients**. Automated tests and a stdio protocol smoke test do not complete this checklist. Record the client version, operating system, commit, configuration, date, and evidence for each completed item.

## Codex

- [ ] Load the built local plugin and confirm the research skill and MCP tools appear.
- [ ] Initialize a separate pilot project using the researcher's Astra database and local library.
- [ ] Import a permitted document and inspect a source/page or region citation against the original.
- [ ] Execute a bounded DC public-source search, retaining query and provenance.
- [ ] Propose two conflicting interpretations and keep both inspectable.
- [ ] Approve one conclusion in chat, verify the exact revision and approval wording in the audit.
- [ ] Correct an approved claim's evidence and confirm it requires renewed review.
- [ ] Interrupt and resume a run without losing sources, search outcomes, or budget accounting.
- [ ] Exhaust a small test budget without automatic paid retry or hidden cap increase.
- [ ] Export Markdown, HTML, and JSON and inspect each for accurate review labels and citations.

## Claude Desktop

- [ ] Configure the absolute-path stdio server and confirm tools appear.
- [ ] Open the same pilot project and inspect the sources and review decisions created through Codex.
- [ ] Complete the document import, bounded search, conflicting-interpretation, and human-approval flow above.
- [ ] Correct evidence and confirm renewed review is required.
- [ ] Resume interrupted work and verify the same budget state is retained.
- [ ] Export the dossier and confirm equivalent review status, provenance, and citation behavior.

## Cross-client portability

- [ ] Back up a project with originals and derived assets, then restore into a fresh project/local library.
- [ ] Open the restored project from both clients and inspect citation targets and source bytes.
- [ ] Confirm a corrupt bundle fails before destination writes and an existing project is not overwritten.
- [ ] Interrupt restore and repeat the exact bundle/destination/operation ID to complete it.
- [ ] Explicitly reuse a reviewed claim in another project and confirm origin provenance survives while approval resets.
- [ ] Inspect exports for runtime credentials and machine-specific metadata paths.
- [ ] Record material limitations and leave any untested item unchecked.
