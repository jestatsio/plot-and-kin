/** This runs from the extracted release with its bundled Node, never the checkout. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { runtimeVersion, version, platform } = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'));
if (process.argv[2]) assert.equal(version, process.argv[2], 'Release version does not match the requested download');
if (process.argv[3]) assert.equal(platform, process.argv[3], 'Release platform does not match the requested download');
assert.equal(process.versions.node, runtimeVersion, 'Smoke must use the bundled runtime');
assert.equal(`${process.platform}-${process.arch}`, platform);
const { DocumentProcessor } = await import('../dist/documents.js');
const { default: sharp } = await import('sharp');

function textPdf() {
  const stream = 'BT /F1 18 Tf 20 90 Td (Historical evidence) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return Buffer.from(pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

const processor = new DocumentProcessor();
const pdf = textPdf();
assert.equal((await processor.extractText(pdf))[0].text, 'Historical evidence');
const rendered = await processor.renderPage(pdf, 1, { scale: 1, crop: { x: 10, y: 10, width: 100, height: 80 } });
assert.equal((await sharp(rendered.bytes).metadata()).format, 'png');
assert.equal(rendered.width, 100);
assert.equal(rendered.transform.offsetX, 10);

const work = await mkdtemp(join(tmpdir(), 'pk-installed-smoke-'));
try {
  const configUrl = new URL('../dist/config.js', import.meta.url).href;
  const appUrl = new URL('../dist/application.js', import.meta.url).href;
  const prefix = `import { readConfig } from ${JSON.stringify(configUrl)}; import { Application } from ${JSON.stringify(appUrl)}; const app = new Application(readConfig({PK_STORAGE:'local',PK_LIBRARY_DIR:${JSON.stringify(work)}})); await app.initialize();`;
  const write = `${prefix} const project = await app.research.createProject({address:'Release smoke fixture',question:'Can a saved case survive a restart?'}); process.stdout.write(project._id); await app.close();`;
  const id = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', write], { cwd: work, encoding: 'utf8' }).trim();
  const read = `${prefix} const projects = await app.store.projects(); if (!projects.some(p => p._id === ${JSON.stringify(id)})) throw new Error('Saved case missing after restart'); await app.close();`;
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', read], { cwd: work, stdio: 'inherit' });
  const actualVersion = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, 'dist/cli.js'), '--version'], { cwd: work, encoding: 'utf8' }).trim();
  assert.equal(actualVersion, version);
  process.stdout.write(`Release smoke passed: ${platform}, Node ${runtimeVersion}, PDF extraction/rendering, saved case restart.\n`);
} finally {
  await rm(work, { recursive: true, force: true });
}
