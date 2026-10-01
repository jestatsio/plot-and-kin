# Prototype validation

Recorded on 2026-10-01. These checks establish implementation behavior, not researcher effectiveness or completed acceptance in the desktop applications.

## Repeatable checks and evidence boundaries

The onboarding implementation adds persistent local storage, recoverable setup, secure settings, client registration, optional Astra transfer, and native release packaging. Test counts and coverage change as this work evolves. Use the exact commit's job results and these commands instead of treating an earlier count as current evidence.

| Layer | Reproduce it | What it establishes |
| --- | --- | --- |
| Types and build | `npm run typecheck` and `npm run build` | Type correctness and compiled entry points |
| Domain and integration tests | `npm run test:coverage` | Evidence, storage, processing, setup, transfer, and recovery behavior covered by the suite |
| Real stdio process | `npm run test:cli` | Protocol discovery and actual server operations in a subprocess |
| Package contents | `npm pack --dry-run` | Compiled entry point, manifests, skill, and license are packaged |
| Native release bundle | `npm run release:package` | Pinned runtime checksum, native PDF/image dependencies, text extraction/rendering, and saved-case restart |
| Installer | `npm run test:installer` after packaging | Isolated-home setup, configuration preservation, rerun, and rejected corrupt downloads |
| Desktop application | [Client acceptance checklist](client-acceptance.md) | Actual client connection, UI, file handling, review, and conversational continuity |

The standard [CI workflow](../.github/workflows/ci.yml) exercises Node 22 and 24. The [native release workflow](../.github/workflows/release.yml) builds on macOS Apple Silicon, macOS Intel, and Windows x64. Configuring a job does not establish that its latest run passed. A packaged researcher release has not been published yet, and native automated checks do not close the desktop acceptance gate.

The onboarding implementation at `6075099` passed the Node 22 and 24 validation jobs and all three targets in [installer workflow 36905685304](https://github.com/jestatsio/plot-and-kin/actions/runs/36905685304). Local coverage validation passed 287 tests plus two CLI subprocess checks. The native bundles use Node 22.23.2 and passed real PDF extraction and rendering, persistent local cases across restart, synthetic credentials in the operating system's credential store, and installation into isolated client configurations. Installation tests preserve unrelated settings, rerun setup, reject corrupt downloads, and exercise paths containing spaces and non-ASCII characters. The Windows installation/rerun/rejection journey completed in 41.2 seconds on its hosted runner, excluding packaging and real network downloads. This is an automated integration result, not a researcher setup-time measurement.

The native credential test is enabled only on disposable CI workers and does not modify a developer's personal keychain. Test artifacts are available from the linked workflow. No public installer release was published by that run.

For historical context, the initial prototype's automated jobs passed for `9434bc8` in [GitHub Actions run 36895894619](https://github.com/jestatsio/plot-and-kin/actions/runs/36895894619). That result predates the onboarding work. Use later commits' own checks for the new behavior.

The documentation site and actual exported HTML dossier were also inspected in a browser at desktop and 390-pixel mobile widths. Images and navigation anchors resolved, code-copy controls reported success, client setup sections opened, and neither page had horizontal overflow at the mobile breakpoint. These are documentation checks, not acceptance of the MCP service inside either desktop client.

The suites include durable local restart and concurrent revisions, guided setup defaults and environment overrides, preserved client configuration, credential references, optional-capability isolation, explicit transfer verification and recovery, contradictory claims, stale approvals, passage corrections, identity proposals, citation bounds, run and budget exhaustion, concurrent writes, provider failures, SSRF protections, path restrictions, malicious document content, HTML escaping, idempotent copies, and validated restoration. Processing recovery tests include saved results, missing checkpoints, stranded reservations after a hard exit, provider/model changes, and restoration without duplicate passages or automatic billing retries.

## Live checks

- The researcher-owned Astra database accepted dedicated `pk_records` and `pk_passages` collections. Lexical capability checks and passage retrieval passed. The existing unrelated `documents` collection was preserved, with its approximate count unchanged at 26 during the check.
- A complete live text workflow retrieved the DC HistoryQuest record for 1920 Rosedale Street NE, reused the source on repeated lookup, retrieved retained evidence lexically, exported HTML, and backed up/restored the project.
- The new local backend also completed a live HistoryQuest lookup for that address, retained a cited proposal, exported HTML, closed and reopened the database, and retrieved its saved passage. No researcher approval was invented during the check.
- HistoryQuest fixtures include the distinct 316 and 318 A Street NE records that share parcel 0785/0046.
- The Sanborn connector returned a real PNG excerpt with the service's actual extent and attribution. The connector accounts for the fused map cache and does not mistake its boundary overlay for the historical raster.

Live checks created test projects in the dedicated Plot & Kin collections. They are not approved historical research conclusions. Source availability and Astra lexical preview behavior can change after this recorded check.

## Remaining acceptance work

- Complete desktop acceptance for the tested native artifacts before publishing a versioned researcher release. One-command download URLs remain unavailable until publication.
- Verify interactive secure credential entry, permission prompts, and locked-store recovery in actual macOS and Windows desktop installations. Native CI tests real credential persistence with synthetic values, while interactive desktop behavior remains a separate check.

- Complete the same research journey in the actual Codex and Claude Desktop applications using [the client checklist](client-acceptance.md). SDK client simulations and subprocess tests do not establish host application acceptance.
- Configure a chosen provider/model and verified prices, then evaluate real printed scans, difficult handwriting, photographs, and maps. Both provider adapters have mocked contract tests. No billable model generation was performed for this validation, and extraction quality has not been measured.
- Recruit five professional researchers and execute [the pilot protocol](pilot.md). Recruitment material is prepared but unsent. Effort reduction, critical evidence errors, repeat use, and willingness to pay remain unmeasured.
- Test clean-install restoration in both real clients. Automated round trips already use fresh destination projects and libraries, but a separate-machine/operator acceptance run remains outstanding.

Review and billing recovery attestations are audited client/operator statements. They do not independently authenticate a human reviewer or prove that another worker has stopped. A stranded `reserved` operation requires an explicit stopped-dispatch attestation and verified provider charge before a separately approved retry.
