import { bins, type Bin, type Db, type User } from '@wi/db';
import { eq } from 'drizzle-orm';

/**
 * Loads a bin the caller is allowed to see.
 *
 * Returns the bin when it has no owner or when `user` owns it, and null
 * otherwise, including when it does not exist. A caller cannot tell a missing
 * bin from someone else's, so a slug cannot be probed to learn whether it is in
 * use. Bins created before accounts existed have no owner and stay open.
 */
export async function loadOwnedBin(db: Db, slug: string, user: User | null): Promise<Bin | null> {
  const [bin] = await db.select().from(bins).where(eq(bins.slug, slug)).limit(1);
  if (!bin) return null;
  if (bin.userId === null || bin.userId === user?.id) return bin;
  return null;
}
