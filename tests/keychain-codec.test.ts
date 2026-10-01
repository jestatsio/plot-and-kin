import { describe, expect, it } from 'vitest';
import { decodeKeychainSecret, encodeKeychainSecret } from '../src/settings.js';

describe('Keychain credential encoding', () => {
  it('keeps Unicode, punctuation and significant whitespace in printable ASCII transport', () => {
    const value = '\ufeff  synthetic "quoted" \\slash $dollar `tick` & ; = : café Ω 東京 🏠  ';
    const encoded = encodeKeychainSecret(value);
    expect(encoded).toMatch(/^plot-and-kin:v1:[A-Za-z0-9+/]+={0,2}$/);
    expect(decodeKeychainSecret(encoded)).toBe(value);
    expect(encoded).not.toContain(value);
  });

  it('continues reading credentials saved in the earlier raw ASCII format', () => {
    expect(decodeKeychainSecret('synthetic-ascii-key')).toBe('synthetic-ascii-key');
    expect(decodeKeychainSecret('deadbeef')).toBe('deadbeef');
  });

  it.each(['', '***', 'YQ', 'YQ===', 'YQ==\n', '/w=='])(
    'rejects damaged encoded credentials without exposing their contents (%j)',
    value => {
      expect(() => decodeKeychainSecret(`plot-and-kin:v1:${value}`)).toThrow('The saved keychain credential is damaged.');
    },
  );
});
