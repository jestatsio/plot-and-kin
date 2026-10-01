/** Publishing is an explicit workflow_dispatch action from an existing tag. */
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReleaseAssets } from './release-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (process.env.PK_RELEASE_REF !== `refs/tags/v${version}`) throw new Error('Publish must run from the existing vVERSION tag that matches package.json');
const directory = join(root, 'artifacts/release');
const { files, checksums } = await verifyReleaseAssets(directory, version);
await writeFile(join(directory, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
// Do not overwrite an existing release or retag a commit on a rerun.
execFileSync('gh', ['release', 'create', `v${version}`, '--verify-tag', '--title', `Plot & Kin ${version}`, '--generate-notes', ...(process.env.PK_RELEASE_DRAFT === '1' ? ['--draft'] : []), ...(version.includes('-') ? ['--prerelease', '--latest=false'] : []), ...files.flatMap(file => [join(directory, file), join(directory, `${file}.sha256`)]), join(directory, 'SHA256SUMS.txt'), join(directory, 'version.txt'), join(root, 'scripts/install.sh'), join(root, 'scripts/install.ps1')], { cwd: root, stdio: 'inherit' });
