# Installable packages and marketplace publication

**Last updated: October 1, 2026**

Plot & Kin packages its own Node runtime and native PDF/image dependencies. The default local workflow starts without a terminal, database account, or model API key after a client package is installed. Optional Astra and scan-processing setup still use the guided terminal workflow.

**Release status:** native preview packages have passed automated checks on Apple Silicon Mac, Intel Mac, and Windows x64. Download them from a successful build below. Public release downloads and the Git marketplace catalog are not published yet. The Apple Silicon Claude Desktop walkthrough verified installation, a fictional sample, citation reading, and dossier export. The full desktop journeys remain on the [client acceptance checklist](client-acceptance.md).

[Getting started](getting-started.md) · [Privacy and data handling](privacy.md) · [Source coverage](source-coverage.md)

## Preview builds available now

1. Open [Build researcher installers](https://github.com/jestatsio/plot-and-kin/actions/workflows/release.yml) while signed in to GitHub.
2. Select a completed, successful run, preferably from `main`. Open its **Artifacts** section.
3. Download the artifact for your computer:

| Computer | Artifact |
| --- | --- |
| Mac with Apple Silicon | `release-darwin-arm64` |
| Mac with Intel processor | `release-darwin-x64` |
| Windows x64 | `release-win32-x64` |

4. Extract the downloaded artifact ZIP. Inside, choose the **`.mcpb`** for Claude Desktop or the **`-codex.zip`** for Codex. Follow the matching client instructions below. The native `.tar.gz` or `.zip` is for guided terminal setup.

Each artifact includes the platform packages, version information, and SHA-256 checksum files. GitHub requires a signed-in account to download workflow artifacts, and the downloads expire according to the repository's retention settings. If a run's artifacts have expired, choose a newer successful run. See [GitHub's artifact download guide](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts).

These are preview builds. A successful automated run is separate from completing the research journey in each desktop client. Published releases will provide stable downloads without this workflow-artifact step.

## Choose your package

| Client / path | File for your platform | First step |
| --- | --- | --- |
| Claude Desktop | `plot-and-kin-VERSION-PLATFORM.mcpb` | Settings → Extensions → Advanced settings → Install extension |
| Codex, Git marketplace, after publication | The `plugins` branch of `jestatsio/plot-and-kin` | Add the marketplace source, then install the entry for your computer |
| Codex, offline marketplace | `plot-and-kin-VERSION-PLATFORM-codex.zip` | Extract, add its folder as a local marketplace source, then install Plot & Kin |
| Both clients, guided setup | Native `.tar.gz` or `.zip` | Extract the preview and run its bundled setup, or use the [one-command installer after release publication](getting-started.md#after-a-packaged-release-is-published) |

Platforms are `darwin-arm64` for Apple Silicon, `darwin-x64` for Intel Mac, and `win32-x64` for Windows x64. Windows ARM64 is not a validated target. Select the matching architecture. Packages are deliberately larger because they include their runtime.

## Claude Desktop

Get the matching `.mcpb` from a [preview build](#preview-builds-available-now), or from the [Releases page](https://github.com/jestatsio/plot-and-kin/releases) once a release is published. Select it using **Settings → Extensions → Advanced settings → Install extension**. Review the package identity and permissions, then install. No required configuration fields appear for the default local workflow.

Start a new Claude conversation and ask **“Help me get started with Plot & Kin.”** Choose an address or a visibly fictional sample. Research is saved under your home directory's `.plot-and-kin` folder, or your previously configured library.

Directly distributed extensions are updated by installing the newer `.mcpb`. They are separate from an approved directory listing and its host-managed updates. The extension exposes MCP tools, instructions, and workflow prompts. It does not install a Claude Code plugin.

## Codex Git marketplace

**Use this path only after the `plugins` catalog branch has been published.** Add the repository's dedicated catalog branch as a marketplace source in a supporting Codex client. The Codex CLI equivalent is:

```sh
codex plugin marketplace add jestatsio/plot-and-kin@plugins
```

In **Plugins**, choose the **Plot & Kin** marketplace and install only the entry matching your computer:

| Computer | Entry | Plugin identifier |
| --- | --- | --- |
| Mac with Apple Silicon | Plot & Kin · Mac · Apple Silicon | `plot-and-kin-darwin-arm64` |
| Mac with Intel processor | Plot & Kin · Mac · Intel | `plot-and-kin-darwin-x64` |
| Windows x64 | Plot & Kin · Windows · x64 | `plot-and-kin-win32-x64` |

The runtime is included in the catalog package. On Macs, first launch verifies and extracts the bundled archive. Windows launches its included Node executable directly. Neither path downloads a runtime or runs guided setup. Start a new chat and ask **“Help me get started with Plot & Kin.”** No Node.js installation or optional service credentials are needed.

Every platform package is checksum-verified when the catalog is built. Refresh the marketplace and install the offered plugin update when a new release is published, then reopen the client. Saved cases and settings remain outside the plugin cache. This custom catalog is maintained by JEStats and is separate from an official OpenAI directory listing.

## Codex offline marketplace

Get the matching `-codex.zip` from a [preview build](#preview-builds-available-now), then extract the entire package to a permanent folder. Keep its hidden `.agents` folder with its `plugins` folder. Add that root folder as a local marketplace source in a supporting client. The Codex CLI equivalent is:

```sh
codex plugin marketplace add "/absolute/path/to/plot-and-kin-codex"
codex plugin add plot-and-kin@plot-and-kin
```

Select **Plot & Kin** and install it in the desktop Plugins interface after adding the source. Local-source UI availability varies by client version. Source registration is a separate step from clicking Install. No Node.js installation or runtime download is needed.

For updates, extract the new package, update the marketplace source, refresh it, and reopen the client. Both the MCP tools and the research skill travel with the package.

## Guided setup from a preview

Extract the native `.tar.gz` or `.zip` from your platform's preview artifact. From the folder containing its extracted `plot-and-kin` directory, run:

**macOS:**

```sh
./plot-and-kin/bin/node ./plot-and-kin/dist/cli.js setup
```

**Windows PowerShell:**

```powershell
& .\plot-and-kin\bin\node.exe .\plot-and-kin\dist\cli.js setup
```

Choose Codex, Claude Desktop, or both, then **Save on this computer**. Restart the selected clients and ask **“Help me get started with Plot & Kin.”** Keep the extracted folder in place because setup registers its runtime path. Use one installation method per client to avoid duplicate tools.

## Optional Astra and scan processing

The default local workflow is ready without setup. When you want Astra or paid document interpretation, use the guided terminal setup with **`--client none`**. This changes saved preferences and credentials without registering a second MCP server beside the installed plugin.

You can use the runtime already installed by guided setup. Alternatively, download the native `.tar.gz` or `.zip` for your platform from a preview build or published release and extract its `plot-and-kin` folder. From the folder containing that extracted directory, connect Astra with:

**macOS:**

```sh
./plot-and-kin/bin/node ./plot-and-kin/dist/cli.js setup --client none --connect-astra
```

**Windows PowerShell:**

```powershell
& .\plot-and-kin\bin\node.exe .\plot-and-kin\dist\cli.js setup --client none --connect-astra
```

For scan interpretation, replace `--connect-astra` with `--processing`. Keep `--client none`. Use the same settings directory as your plugin if you configured a custom one. Enter secrets only in the masked terminal prompt, then restart the client. The package reads the saved settings and OS credential vault on its next launch.

See [Astra](getting-started.md#connect-astra-when-you-want-it) for deliberate case transfers and [scan interpretation](getting-started.md#optional-scan-interpretation) for provider selection and processing limits. Connecting Astra does not move cases automatically or back up local original files.

## Existing installations and saved work

Use one registration method per client. If guided setup already registered a `plot-and-kin` MCP server, remove that old registration through the client's controls before enabling its extension/plugin, so tools do not appear twice. Preserve unrelated servers. Back up configuration before editing it manually.

The new packages read existing settings and the OS credential vault. They do not run setup or change client settings themselves. Default cases, originals, imports, exports, and settings stay outside the plugin cache. A custom `PK_SETTINGS_DIR` from an older installation must be supplied explicitly to the new registration if you want to continue using it.

Make a portable case backup before an upgrade. Removing a plugin does not remove research or saved optional credentials. Restart both clients after a runtime update to close old server processes.

## Public directory submission

Direct distribution and public directory approval are separate milestones:

- **Claude Desktop:** submit the validated `.mcpb` through the desktop-extension submission form linked in [Claude's local MCP documentation](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop). The general remote-connector submission route is different.
- **OpenAI:** custom marketplaces support local execution. The documented public MCP submission route expects a public HTTPS server. Contact OpenAI about local-MCP eligibility before promising an official listing. See [submission guidance](https://developers.openai.com/plugins/guides/submit-claude-plugin).

Listing draft: **Plot & Kin — Discover the stories behind an address.** Research Washington, DC property history, compare archival evidence, review proposed findings, and return to a saved dossier. Local storage works without a separate database or model key. Selected public sources provide starting points, not comprehensive property coverage.

Before submission, verify published artifact checksums, actual client installation and update evidence, screenshots of the real installed experience, support links, the public [privacy notice](https://jestatsio.github.io/plot-and-kin/privacy.html), publisher identity, and accurate source and processing disclosures. Do not claim review, endorsement, or an approval timetable before the marketplace confirms it.
