export type Cursor = { receivedAt: Date; id: string };

/** Encodes the sort key of the last row on a page. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.receivedAt.toISOString()}|${cursor.id}`).toString('base64url');
}

/**
 * Decodes a cursor produced by `encodeCursor`.
 *
 * Returns null for anything that does not decode to a valid timestamp and UUID,
 * so a caller can answer 400 rather than trusting a value that arrived in a
 * query string.
 */
export function decodeCursor(value: string): Cursor | null {
  const [timestamp, id, ...rest] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  if (!timestamp || !id || rest.length > 0) return null;

  const receivedAt = new Date(timestamp);
  if (Number.isNaN(receivedAt.getTime())) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;

  return { receivedAt, id };
}
