import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { OperatingSystemVault } from '../src/settings.js';

const execute = promisify(execFile);
// Opt in only on disposable CI workers. Normal developer tests never modify a login keychain.
const enabled = process.env.PK_TEST_NATIVE_CREDENTIALS === '1'
  && process.env.CI === 'true'
  && ['darwin', 'win32'].includes(process.platform);
const cleanup: Array<{ directory: string; credentialId: string }> = [];

async function removeSyntheticKeychainEntry(directory: string, credentialId: string): Promise<void> {
  // Match OperatingSystemVault's namespace exactly, without inspecting or touching other keychain items.
  const service = `io.jestats.plot-and-kin.${createHash('sha256').update(resolve(directory)).digest('hex').slice(0, 24)}`;
  try {
    await execute('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', credentialId], { timeout: 15_000, maxBuffer: 64 * 1024 });
  } catch (error) {
    // security returns 44 if set failed before creating the item. All other cleanup failures are significant.
    if ((error as { code?: number }).code !== 44) throw new Error(`Could not remove synthetic CI keychain entry ${service}/${credentialId}. Unlock the CI keychain and remove this exact test entry.`, { cause: error });
  }
}

afterEach(async () => {
  for (const entry of cleanup.splice(0)) {
    try { if (process.platform === 'darwin') await removeSyntheticKeychainEntry(entry.directory, entry.credentialId); }
    finally { await rm(entry.directory, { recursive: true, force: true }); }
  }
}, 30_000);

describe.skipIf(!enabled)('real operating system credential persistence (disposable CI only)', () => {
  it('round trips and replaces a synthetic credential through fresh vault instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pk-native-vault-é space-'));
    const credentialId = randomUUID();
    cleanup.push({ directory, credentialId });
    // These are deliberately fake values. Quotes, slashes and Unicode exercise actual OS command encoding.
    const initial = `pk-synthetic-${randomUUID()} 'single' "double" \\slash $dollar \`tick\` & ; = : café Ω 東京`;
    const replacement = `pk-synthetic-replacement-${randomUUID()} !@#%^&*()[]{}|<>?/ "quoted" é Σ 日本語`;
    const first = new OperatingSystemVault(directory);
    await first.set(credentialId, initial);
    expect(await new OperatingSystemVault(directory).get(credentialId)).toBe(initial);
    await new OperatingSystemVault(directory).set(credentialId, replacement);
    expect(await new OperatingSystemVault(directory).get(credentialId)).toBe(replacement);
    if (process.platform === 'win32') {
      const encrypted = await readFile(join(directory, 'credentials', `${credentialId}.dpapi`), 'utf8');
      expect(encrypted.length).toBeGreaterThan(0);
      expect(encrypted).not.toContain(initial);
      expect(encrypted).not.toContain(replacement);
    }
  }, 120_000);
});
