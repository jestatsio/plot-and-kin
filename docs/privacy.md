# Privacy and data handling

Effective October 1, 2026. Applies to the Plot & Kin open-source local server and distributed client packages, version 0.1.0.

Plot & Kin runs on your computer. JEStats does not operate a hosted research service for this prototype. The server has no product analytics, telemetry, or automatic upload of your research to JEStats.

## What is saved

By default, cases, passages, findings, review decisions, research logs, and processing state are saved in a local SQLite database. Original documents, page images, imports, and exported dossiers are saved in the local library. The default location is `.plot-and-kin` in your home directory. These files persist when you update or uninstall an extension. Your configured location can differ.

## When data leaves your computer

- **Your chat client:** Codex or Claude receives the tool results and document content requested in the research conversation. Its account, retention, and privacy settings apply. Local server storage does not make the conversation offline or private from your client provider.
- **Public records and supplied URLs:** Searching DC sources sends the search terms or requested map extent to the relevant public service. Fetching a public document URL contacts that site's operator. Those services receive ordinary connection information such as your IP address.
- **Optional Astra:** If you configure Astra, structured research for explicitly transferred cases or your selected Astra default is stored in your database. Original document bytes remain local. Astra is not a backup of the local library.
- **Optional document processing:** If you configure OpenAI or Anthropic, requested processing sends the relevant page, image, and processing instructions to your chosen provider. Its terms and data policies apply. There is no automatic provider switch.
- **Installation and updates:** Downloading packages contacts GitHub and its delivery services. Marketplace hosts may check for updates under their own settings. The installed server does not send research to the package download host.

No database or model API credentials are needed for the default local, public-record, and text-document workflow. Optional credentials entered through guided setup are protected by macOS Keychain or Windows DPAPI. They are not included in research exports or client registration files.

## Your control

You choose what material to import and whether to use optional services. Import only material you are permitted to possess, process, and share. Dossiers and backups preserve original evidence content and are **not automatically redacted**. Review them before sharing.

The local server does not automatically delete your saved research. Uninstalling the extension preserves it. Use portable backups before removing your chosen library folder. If you used optional cloud services or shared content through a chat client, manage those copies through the corresponding service. Removing local files does not delete third-party copies.

For product questions, use [GitHub issues](https://github.com/jestatsio/plot-and-kin/issues). Issues are public. Do not include credentials, private addresses, confidential documents, or sensitive research in a report. This notice describes the software's data flows, not the policies of third-party clients, hosting providers, or archival sources.

[Evidence and data](evidence-and-data.md) · [Installation](getting-started.md)
