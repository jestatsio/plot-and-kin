# Prototype validation

Recorded on 2026-10-01. These checks establish implementation behavior, not researcher effectiveness or completed acceptance in the desktop applications.

## Automated checks

| Check | Result |
| --- | --- |
| TypeScript type checking | Passed |
| Vitest domain, storage, connector, processing, portability, and MCP contracts | 199 tests passed across 13 suites |
| Coverage excluding the separately exercised CLI | 87.43% statements, 84.13% branches, 86.32% functions, 97.62% lines |
| Production TypeScript build | Passed |
| CLI subprocess tests | 2 passed, including a real stdio MCP process and a synthetic dossier/restore journey |
| npm package dry run | Required compiled entry point, plugin manifests, MCP configuration, skill, and license included |

Run `npm run typecheck`, `npm run test:coverage`, `npm run build`, and `npm run test:cli` to repeat the checks. The checked-in CI workflow runs these checks on Node 22 and 24. This record does not claim that remote CI has run.

Tests cover contradictory claims, stale approvals, passage corrections, identity proposals, citation bounds, run and budget exhaustion, concurrent writes, provider failures, SSRF protections, path restrictions, malicious document content, HTML escaping, idempotent copies, and validated restoration. Processing recovery tests include saved results, missing checkpoints, stranded reservations after a hard exit, provider/model changes, and restoration without duplicate passages or automatic billing retries.

## Live checks

- The researcher-owned Astra database accepted dedicated `pk_records` and `pk_passages` collections. Lexical capability checks and passage retrieval passed. The existing unrelated `documents` collection was preserved, with its approximate count unchanged at 26 during the check.
- A complete live text workflow retrieved the DC HistoryQuest record for 1920 Rosedale Street NE, reused the source on repeated lookup, retrieved retained evidence lexically, exported HTML, and backed up/restored the project.
- HistoryQuest fixtures include the distinct 316 and 318 A Street NE records that share parcel 0785/0046.
- The Sanborn connector returned a real PNG excerpt with the service's actual extent and attribution. The connector accounts for the fused map cache and does not mistake its boundary overlay for the historical raster.

Live checks created test projects in the dedicated Plot & Kin collections. They are not approved historical research conclusions. Source availability and Astra lexical preview behavior can change after this recorded check.

## Remaining acceptance work

- Complete the same research journey in the actual Codex and Claude Desktop applications using [the client checklist](client-acceptance.md). SDK client simulations and subprocess tests do not establish host application acceptance.
- Configure a chosen provider/model and verified prices, then evaluate real printed scans, difficult handwriting, photographs, and maps. Both provider adapters have mocked contract tests. No billable model generation was performed for this validation, and extraction quality has not been measured.
- Recruit five professional researchers and execute [the pilot protocol](pilot.md). Recruitment material is prepared but unsent. Effort reduction, critical evidence errors, repeat use, and willingness to pay remain unmeasured.
- Test clean-install restoration in both real clients. Automated round trips already use fresh destination projects and libraries, but a separate-machine/operator acceptance run remains outstanding.

Review and billing recovery attestations are audited client/operator statements. They do not independently authenticate a human reviewer or prove that another worker has stopped. A stranded `reserved` operation requires an explicit stopped-dispatch attestation and verified provider charge before a separately approved retry.
