import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';

const id = '3f3d4c8a-6a0e-4a4a-9a1f-0f2c1d9b7e55';

describe('cursor', () => {
  it('round trips a row id', () => {
    expect(decodeCursor(encodeCursor({ id }))).toBe(id);
  });

  it('rejects values it did not produce', () => {
    for (const value of ['', 'not-base64!!', Buffer.from('nope').toString('base64url')]) {
      expect(decodeCursor(value), value).toBeNull();
    }
  });
});
