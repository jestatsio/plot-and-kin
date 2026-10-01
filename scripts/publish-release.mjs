/** Publishing is an explicit workflow_dispatch action from an existing tag. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (process.env.PK_RELEASE_REF !== `refs/tags/v${version}`) throw new Error('Publish must run from the existing vVERSION tag that matches package.json');
const directory = join(root, 'artifacts/release');
const files = [`plot-and-kin-${version}-darwin-arm64.tar.gz`, `plot-and-kin-${version}-darwin-x64.tar.gz`, `plot-and-kin-${version}-win32-x64.zip`];
const sums = [];
for (const file of files) {
  const hash = createHash('sha256').update(await readFile(join(directory, file))).digest('hex');
  const expected = (await readFile(join(directory, `${file}.sha256`), 'utf8')).trim();
  if (expected !== `${hash}  ${file}`) throw new Error(`Release checksum mismatch: ${file}`);
  sums.push(expected);
}
await writeFile(join(directory, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
if ((await readFile(join(directory, 'version.txt'), 'utf8')).trim() !== version) throw new Error('Release version mismatch');
// Do not overwrite an existing release or retag a commit on a rerun.
execFileSync('gh', ['release', 'create', `v${version}`, '--verify-tag', '--title', `Plot & Kin ${version}`, '--generate-notes', ...(version.includes('-') ? ['--prerelease', '--latest=false'] : []), ...files.map(file => join(directory, file)), join(directory, 'SHA256SUMS.txt'), join(directory, 'version.txt'), join(root, 'scripts/install.sh'), join(root, 'scripts/install.ps1')], { cwd: root, stdio: 'inherit' });
