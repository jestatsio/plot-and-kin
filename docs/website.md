# Maintaining the documentation site

The public site is static HTML, CSS, and JavaScript in `docs/site/`. It has no framework, runtime service, analytics, or build dependency. The README links to the same visual assets and setup documentation.

## Preview

From the repository root, use any local static server. For example, when Python is available:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory docs/site
```

Open `http://127.0.0.1:4173`. Check desktop and mobile layouts, keyboard focus, navigation, code-copy controls, and the example dossier. Keep site paths relative so deployment beneath `/plot-and-kin/` works.

## Example and screenshots

```sh
npm ci
npm run docs:example
```

The script imports two invented documents through the real application, proposes cited findings without approving them, and writes the actual HTML export to `docs/site/examples/dossier.html`. It uses temporary in-memory research and does not need credentials, network access, or model calls.

When the export presentation changes, capture new browser screenshots of that file. Keep fictional material labeled, retain visible review states, and update the assets described in `docs/site/assets/README.md`. Screenshots are documentation of the exported report, not a claim that the service includes a standalone web application.

## Publish

The `Publish documentation` GitHub Actions workflow publishes only `docs/site/` to GitHub Pages when that directory changes on `main`. It can also run manually. Repository Pages settings use GitHub Actions as the publishing source.

After a deployment, check the workflow's exact commit and inspect the live page and example. Core validation runs separately in `Validate prototype`. A successful documentation deployment does not establish that product CI or desktop-client acceptance passed.
