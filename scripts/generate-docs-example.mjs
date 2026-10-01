/** Generate the public, fictional example through the real import and export pipeline.
 * Run after `npm run build`: node scripts/generate-docs-example.mjs
 * No network requests, model calls, database credentials, or human approvals are used.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Application } from '../dist/application.js';

const workspace = await mkdtemp(join(tmpdir(), 'plot-and-kin-docs-'));
const output = fileURLToPath(new URL('../docs/site/examples/dossier.html', import.meta.url));

try {
  const app = new Application({
    storage: 'memory', keyspace: 'default_keyspace', libraryDir: workspace,
    importDir: join(workspace, 'imports'), exportDir: join(workspace, 'exports'),
  });
  await app.initialize();
  const project = await app.research.createProject({
    address: 'Example House',
    question: 'Synthetic demonstration: what do two fictional records suggest about occupancy and alterations at Example House? All people, records, and property details in this dossier are invented',
    knownInformation: 'This fictional case demonstrates the software. It makes no historical claims about any real property or person.',
    sourceConstraints: ['Use only the two invented text records supplied for this demonstration.'],
    idempotencyKey: 'public-fictional-example-v1',
  });
  const projectId = project._id;
  const run = await app.research.startRun(projectId, { idempotencyKey: 'public-fictional-example-run-v1' });
  const directory = await app.importDocument(projectId, run._id, {
    title: 'Fictional city directory · 1901', filename: 'fictional-directory-1901.txt', mimeType: 'text/plain',
    base64: Buffer.from('SYNTHETIC DEMONSTRATION — NOT AN ARCHIVAL RECORD\nFictional city directory, 1901\nExample House: Ada Example, resident.\nThis invented directory entry identifies an occupant. It does not identify a property owner.\n').toString('base64'),
    rights: 'Original fictional text created for the Plot & Kin demonstration. Apache-2.0.',
    attribution: 'Plot & Kin synthetic example. No real person or property is represented.',
  });
  const permit = await app.importDocument(projectId, run._id, {
    title: 'Fictional alteration register · 1902', filename: 'fictional-permit-1902.txt', mimeType: 'text/plain',
    base64: Buffer.from('SYNTHETIC DEMONSTRATION — NOT AN ARCHIVAL RECORD\nFictional permit register, 1902\nExample House: application to alter the existing rear porch.\nWork category: alteration of an existing structure.\nThe permit date does not establish the original construction date or confirm when work was completed.\n').toString('base64'),
    rights: 'Original fictional text created for the Plot & Kin demonstration. Apache-2.0.',
    attribution: 'Plot & Kin synthetic example. No real person or property is represented.',
  });
  const directoryPassage = await app.processPage(projectId, run._id, directory._id, 1);
  const permitPassage = await app.processPage(projectId, run._id, permit._id, 1);
  await app.research.proposeClaim(projectId, {
    statement: 'The fictional 1901 directory lists Ada Example as an occupant of Example House. Ownership remains unestablished.',
    eventDate: '1901', category: 'occupancy',
    evidence: [{ passageId: directoryPassage._id, stance: 'supporting' }],
    idempotencyKey: 'fictional-occupancy-v1',
  });
  await app.research.proposeClaim(projectId, {
    statement: 'The fictional 1902 register describes an application to alter an existing rear porch. It does not establish the original construction date.',
    eventDate: '1902', category: 'permit',
    evidence: [{ passageId: permitPassage._id, stance: 'supporting' }],
    idempotencyKey: 'fictional-alteration-v1',
  });
  await app.research.proposeClaim(projectId, {
    statement: 'Competing hypothesis for review: Example House was first constructed in 1902. The earlier occupancy entry and the alteration wording oppose this interpretation.',
    eventDate: '1902', category: 'construction_hypothesis',
    evidence: [
      { passageId: directoryPassage._id, stance: 'opposing' },
      { passageId: permitPassage._id, stance: 'opposing' },
    ],
    idempotencyKey: 'fictional-competing-hypothesis-v1',
  });
  await app.research.addLog(projectId, {
    type: 'research_gap', message: 'Original construction date, ownership, and completion of the proposed alteration remain unresolved in this fictional example.',
    gap: 'Neither invented source establishes ownership or the original construction date. No external search was performed. Missing evidence is not evidence of absence.',
    nextStep: 'For a real case, inspect permitted original construction and ownership records, and review every proposal against its cited source.',
    idempotencyKey: 'fictional-research-gap-v1',
  });
  await app.research.checkpointRun(projectId, run._id, 'Synthetic demonstration complete. All three claims remain proposals. No researcher approval has been recorded.');
  const exported = await app.writeExport(projectId, 'html');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, await readFile(exported.path));
  console.log(`Generated ${output} from the actual application export pipeline.`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
