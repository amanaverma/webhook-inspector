import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';

const cursor = { receivedAt: new Date('2026-09-05T10:11:12.130Z'), id: '3f3d4c8a-6a0e-4a4a-9a1f-0f2c1d9b7e55' };

describe('cursor', () => {
  it('round trips', () => {
    const decoded = decodeCursor(encodeCursor(cursor));
    expect(decoded?.id).toBe(cursor.id);
    expect(decoded?.receivedAt.toISOString()).toBe(cursor.receivedAt.toISOString());
  });

  it('rejects values it did not produce', () => {
    for (const value of ['', 'not-base64!!', Buffer.from('nope').toString('base64url'),
      Buffer.from('2026-09-05T10:11:12.130Z|not-a-uuid').toString('base64url'),
      Buffer.from(`bad-date|${cursor.id}`).toString('base64url'),
      Buffer.from(`2026-09-05T10:11:12.130Z|${cursor.id}|extra`).toString('base64url')]) {
      expect(decodeCursor(value), value).toBeNull();
    }
  });
});
