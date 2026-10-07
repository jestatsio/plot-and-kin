/** Validate the complete native release before uploading any public assets. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function releaseAssetNames(version) {
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('Invalid release version');
  return [...['darwin-arm64', 'darwin-x64', 'win32-x64'].flatMap(platform => {
    const prefix = `plot-and-kin-${version}-${platform}`;
    return [`${prefix}.${platform === 'win32-x64' ? 'zip' : 'tar.gz'}`, `${prefix}.mcpb`, `${prefix}-codex.zip`];
  }), `plot-and-kin-${version}-claude-code.zip`];
}

export async function verifyReleaseAssets(directory, version) {
  const files = releaseAssetNames(version);
  const checksums = [];
  for (const file of files) {
    const hash = createHash('sha256').update(await readFile(join(directory, file))).digest('hex');
    const expected = (await readFile(join(directory, `${file}.sha256`), 'utf8')).trim();
    if (expected !== `${hash}  ${file}`) throw new Error(`Release checksum mismatch: ${file}`);
    checksums.push(expected);
  }
  if ((await readFile(join(directory, 'version.txt'), 'utf8')).trim() !== version) throw new Error('Release version mismatch');
  return { files, checksums };
}
