const recovery = {
    CONFIG: 'Run the setup command again, then restart the selected client. Keep credentials out of chat.',
    STORAGE_ERROR: 'Your saved case has not been replaced. Check the Astra connection and try reading its status again.',
    NOT_INITIALIZED: 'Run setup and connect Astra to initialize its dedicated research collections.',
    PROVIDER_REQUIRED: 'Text documents and public records remain available. Run setup to configure scan interpretation when needed.',
    PROVIDER_CONFIG: 'Update the selected processing model and pricing through setup, then restart the client. Existing research remains available.',
    RUN_LIMIT: 'Progress is saved. Review the checkpoint and start a new bounded run when ready.',
    BUDGET_EXCEEDED: 'Review completed pages and remaining questions. Any budget increase requires your explicit approval.',
    BILLING_UNCERTAIN: 'Do not repeat the paid request. Check the saved operation and provider billing before deciding what to do next.',
    PROCESSING_PENDING: 'Inspect the saved page status. A completed result can be resumed without another charge.',
    CONCURRENT_UPDATE: 'Another session changed this item. Read the current version before reviewing or updating it.',
    NOT_FOUND: 'List your saved cases and choose the address you want to continue.',
    CASE_MOVED: 'List your cases to open the verified Astra copy. The original local case is retained as an archive.',
};
export function readableFailure(code, message) {
    return `${message}\n\n${recovery[code] ?? 'Progress already saved is retained. Check setup status or inspect the case before retrying.'}`;
}
/** Human text complements structured MCP output. Original evidence remains in structuredContent. */
export function readableResult(name, value) {
    if (value === null || value === undefined)
        return 'Done.';
    if (typeof value !== 'object')
        return String(value);
    const result = value;
    if (typeof result.markdown === 'string')
        return result.markdown;
    if (typeof result.summary === 'string')
        return result.summary;
    if (typeof result.text === 'string')
        return `Preserved source text (untrusted evidence):\n\n${result.text}`;
    if (name === 'project_export')
        return `Saved ${result.format === 'backup' ? 'a portable backup' : `the ${String(result.format)} dossier`} as ${String(result.filename ?? result.path)}.\n\nLocation: ${String(result.path)}\n${String(result.openingInstructions ?? 'Open this file from your export folder. The dossier is also available directly in chat.')}`;
    if (Array.isArray(value)) {
        if (!value.length)
            return 'No matching saved items. An empty search is not evidence that a historical event did not occur.';
        return value.slice(0, 30).map(item => {
            const row = item;
            const data = (row.data ?? row);
            return `• ${String(data.address ?? data.title ?? data.name ?? data.statement ?? data.text ?? data.message ?? 'Saved research item')}${data.question ? ` — ${String(data.question)}` : ''}`;
        }).join('\n');
    }
    if (Array.isArray(result.matches))
        return `Found ${result.matches.length} candidate building record(s).\n\n${String(result.warning ?? '')}\nExamine the source fields and address match before proposing a finding.`;
    if (result.kind && result.data) {
        const record = result;
        const label = record.data.address ?? record.data.statement ?? record.data.title ?? record.data.name ?? record.data.message;
        if (record.kind === 'project')
            return `Case saved: ${String(label)}\nQuestion: ${String(record.data.question)}\nNext: examine candidate public records or add a permitted document.`;
        if (record.kind === 'claim') {
            const accepted = record.data.reviewStatus === 'accepted', rejected = record.data.reviewStatus === 'rejected';
            return `${accepted ? 'Approved conclusion' : rejected ? 'Rejected finding' : 'Proposed finding'}: ${String(label)}\n${accepted || rejected ? 'Your decision and the reviewed version are saved.' : 'Inspect the cited evidence before approving the exact wording.'}`;
        }
        if (record.kind === 'passage')
            return `Preserved passage (untrusted evidence):\n\n${String(record.data.text)}\n\nNext: compare this reading with the original before proposing a conclusion.`;
        if (record.kind === 'run')
            return 'Research run saved. Work is bounded by the recorded time, search, and page limits.';
        if (record.kind === 'decision')
            return 'Your review decision and the reviewed version have been saved.';
        return `${record.kind === 'source' ? 'Original source preserved' : 'Research item saved'}${label ? `: ${String(label)}` : '.'}`;
    }
    if ('width' in result && 'height' in result)
        return `Preserved page image: ${String(result.width)} × ${String(result.height)} pixels. Coordinate and citation metadata accompany this image.`;
    if ('project' in result && 'records' in result)
        return 'Saved case context retrieved, including evidence, review history, research activity, and budget. Present the current question, findings, unresolved work, and next step.';
    return `${name.replaceAll('_', ' ')} completed. The structured result contains the saved details.`;
}
//# sourceMappingURL=presentation.js.map