import { describe, it, expect, beforeAll } from '@jest/globals';
import { webcrypto } from 'node:crypto';
import { sha256Hex, matchesSha256 } from '@/utils/contentStore';

// jest's jsdom ships `crypto.getRandomValues` but not `crypto.subtle`, so the
// real implementation would find no digest to run. Node's webcrypto is the same
// interface the browser exposes; grafting it in exercises the actual code path
// rather than skipping every assertion.
beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
});

// The published digests of the two vectors any SHA-256 implementation must
// reproduce — if these ever fail, the runtime check is broken, not the content.
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('sha256Hex', () => {
  it('matches the published digest of the empty input', async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(EMPTY_SHA256);
  });

  it('matches the published digest of "abc"', async () => {
    expect(await sha256Hex(bytes('abc'))).toBe(ABC_SHA256);
  });

  it('is lowercase hex, 64 characters', async () => {
    const hex = await sha256Hex(bytes('quran'));
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('matchesSha256', () => {
  it('accepts bytes that match the expected hash', async () => {
    expect(await matchesSha256(bytes('abc'), ABC_SHA256)).toBe(true);
  });

  it('rejects bytes that do not', async () => {
    expect(await matchesSha256(bytes('abd'), ABC_SHA256)).toBe(false);
  });

  it('treats an uppercase expectation as the same hash', async () => {
    expect(await matchesSha256(bytes('abc'), ABC_SHA256.toUpperCase())).toBe(true);
  });

  it('returns null when there is nothing to check against', async () => {
    expect(await matchesSha256(bytes('abc'), undefined)).toBeNull();
    expect(await matchesSha256(bytes('abc'), '')).toBeNull();
  });
});
