# Claude Desktop installation acceptance

On October 1, 2026, the operator authorized installation of the built extension in Claude Desktop. The walkthrough used the real desktop UI and a clearly labeled fictional case, with no external research, private documents, or paid document processing.

| Item | Recorded value |
| --- | --- |
| Extension | Plot & Kin 0.1.0, macOS Apple Silicon |
| Source commit | `0a4e54c50019e512d42b18af579b70be15fd9c95` |
| Native build | [Workflow 36920241376](https://github.com/jestatsio/plot-and-kin/actions/runs/36920241376) |
| Package | `plot-and-kin-0.1.0-darwin-arm64.mcpb` |
| Package SHA256 | `a3be58672c3ebce22c66e7f4164f635e95740fe643bcfa61aeae6a33864a102c` |
| Client | Claude Desktop 2.16120.0 |
| System | macOS 27.0.1, build 26A434, Apple Silicon |
| Bundled runtime | Node 22.23.2 |
| Operator | Codex desktop automation, with researcher authorization |

## Observed results

- Installed through Settings → Extensions → Advanced settings → Install extension. Claude displayed the package identity, all requirements met, its standard local-extension access warning, and an installation confirmation. The installed extension showed **Enabled**, with no required configuration or API-key fields.
- In a new Claude chat, setup status reported the local workflow ready. The sample tool opened **Example House — synthetic sample** with one source, one proposed occupancy finding, zero approved conclusions, and the full processing budget unspent.
- Read the preserved synthetic directory through Plot & Kin. Claude displayed the passage and page-level locator, distinguished occupancy from ownership, and retained the source's fictional status.
- Recorded the requested next step and saved an HTML dossier. The dossier was also readable directly in chat. No claim-review approval was requested or recorded by the automation.
- Independently read the saved HTML to verify its source text, locator, proposed status, and next step. The file was `Example-House-synthetic-sample-html-63582fbd.html`, 10,693 bytes, SHA256 `2214559b2357c6c1e3e2e71aa1622c31923300ee4893ae080fe7a01f3634c41e`.
- Quit Claude, verified that the app was no longer running, and reopened it. The new window reported a cold launch. Recovery of the case through a new chat remains unverified because the UI changed to the extension's tool-settings screen before the recovery request was sent.

![Plot & Kin installed and enabled in Claude Desktop](../site/assets/claude-extension-installed.jpg)

The screenshot is an unmodified capture of the installed extension. It shows Claude's standard warning for a directly installed local extension. It does not represent an approved directory listing.

## Findings and remaining checks

The exported dossier exposed two presentation defects: a period appended after a question mark, and rights and attribution text joined without distinct labels. Both are fixed in the source after this package was built. The corrected HTML and Markdown output passed a fresh sample export, typecheck, and the 46 existing portability/transfer tests. The installed package recorded above still contains the original presentation.

The first-use host requested tool permissions. The automation selected **Allow once** when prompted rather than changing persistent permission policy. File-picker and window-state automation interruptions are not evidence of an extension failure or a measurement of unassisted researcher setup time.

Still open: fresh-chat recovery after restart, upgrade through Claude's UI, public-source research, explicit researcher review, image/crop display, and the corresponding desktop journey in Codex. Intel Mac and Windows have native automated acceptance but no recorded GUI walkthrough here. See the [full acceptance checklist](../client-acceptance.md).
