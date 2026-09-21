const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Encodes the id of the last row on a page.
 *
 * Only the id travels. The sort position is looked up from the row itself when
 * the next page is read, because `received_at` holds microseconds that a
 * JavaScript Date truncates, which would make rows sharing a millisecond with
 * the last row of a page unreachable.
 */
export function encodeCursor(row: { id: string }): string {
  return Buffer.from(row.id).toString('base64url');
}

/** Returns the row id a cursor carries, or null if it is not one we issued. */
export function decodeCursor(value: string): string | null {
  const id = Buffer.from(value, 'base64url').toString('utf8');
  return UUID.test(id) ? id : null;
}
