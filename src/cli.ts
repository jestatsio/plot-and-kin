#!/usr/bin/env node
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Application } from './application.js';
import { readConfig } from './config.js';
import { createServer } from './server.js';
import { PKError } from './types.js';

const HELP = `Plot & Kin 0.1.0 — evidence-backed property research

Usage: plot-and-kin <command>
  init                         Create only pk_records and pk_passages, check lexical support
  doctor                       Check configured storage and processing capability
  serve                        Start the MCP stdio server (no stdout diagnostics)
  demo                         Run a synthetic case locally without external services
  export <projectId> [format]   Write markdown (default), html, or json dossier
  backup <projectId>            Write a complete portable backup
  restore <file> <projectId> [operationId]
                               Restore a backup to a fresh project, never overwrite

Configure Astra and optional model credentials through environment variables.
See README.md. Memory storage is available only when explicitly configured or using demo.
`;

async function main(): Promise<void> {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (['help','--help','-h'].includes(command)) { process.stdout.write(HELP); return; }
  if (['--version','version'].includes(command)) { process.stdout.write('0.1.0\n'); return; }
  if (!['init','doctor','serve','demo','export','backup','restore'].includes(command)) throw new PKError('USAGE', `Unknown command.\n${HELP}`);
  const config = readConfig(command === 'demo' ? { ...process.env, PK_STORAGE: 'memory', PK_PROVIDER: undefined } : process.env);
  const app = new Application(config);
  let result: unknown;
  switch (command) {
    case 'init': result = await app.initialize(); break;
    case 'doctor': result = await app.diagnose(); break;
    case 'serve': {
      await app.diagnose();
      const server = createServer(app);
      await server.connect(new StdioServerTransport());
      return;
    }
    case 'demo': {
      await app.initialize();
      const project = await app.research.createProject({ address: 'Example House (synthetic demonstration)', question: 'Who occupied the house in 1901?', knownInformation: 'All names and records in this demo are fictional.' });
      const run = await app.research.startRun(project._id);
      const source = await app.importDocument(project._id, run._id, { title: 'Synthetic city directory, 1901', mimeType: 'text/plain', base64: Buffer.from('Ada Example, resident of Example House, 1901.\nThis is synthetic demonstration material, not a historical source.').toString('base64'), rights: 'Synthetic fixture created for demonstration' });
      const passage = await app.processPage(project._id, run._id, source._id, 1);
      await app.research.proposeClaim(project._id, { statement: 'Ada Example occupied Example House in 1901 (synthetic example).', category: 'occupancy', eventDate: '1901', evidence: [{ passageId: passage._id, stance: 'supporting' }] });
      await app.research.addLog(project._id, { type: 'next_step', message: 'Review the source and explicitly approve or reject the proposal. This demo never fabricates a human approval.' });
      const markdown = await app.writeExport(project._id, 'markdown');
      const html = await app.writeExport(project._id, 'html');
      const backup = await app.writeExport(project._id, 'backup');
      const bundle = await app.backup(project._id);
      const restored = await app.restore(bundle, `demo-restored-${randomUUID()}`, `demo-restore-${randomUUID()}`);
      result = { projectId: project._id, synthetic: true, exports: { markdown, html, backup }, roundTrip: restored, note: 'Records are in memory for this demo. Saved exports persist. Configure Astra for persistent research.' }; break;
    }
    case 'export': {
      const [projectId, format = 'markdown'] = args;
      if (!projectId || !['markdown','html','json'].includes(format)) throw new PKError('USAGE', 'export requires a project ID and markdown, html, or json format');
      result = await app.writeExport(projectId, format as 'markdown'|'html'|'json'); break;
    }
    case 'backup': {
      if (!args[0]) throw new PKError('USAGE', 'backup requires a project ID');
      result = await app.writeExport(args[0], 'backup'); break;
    }
    case 'restore': {
      const [file, projectId, requestedOperationId] = args;
      if (!file || !projectId) throw new PKError('USAGE', 'restore requires a file and fresh destination project ID');
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 250*1024*1024) throw new PKError('INVALID_BUNDLE', 'Backup must be a regular file of at most 250 MiB');
        const raw = await handle.readFile('utf8');
        if (Buffer.byteLength(raw) > 250*1024*1024) throw new PKError('INVALID_BUNDLE', 'Backup grew beyond the size limit');
        const bundle = JSON.parse(raw);
        const operationId = requestedOperationId ?? `restore-${createHash('sha256').update(JSON.stringify([projectId,bundle])).digest('hex')}`;
        result = await app.restore(bundle, projectId, operationId);
      } finally { await handle.close(); }
      break;
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
main().catch(error => {
  const failure = error instanceof PKError ? { code: error.code, message: error.message } : { code: 'OPERATION_FAILED', message: 'Operation failed. Check configuration, file access, and saved state. No credentials or raw upstream errors are printed.' };
  process.stderr.write(`${JSON.stringify(failure)}\n`);
  process.exitCode = 1;
});
