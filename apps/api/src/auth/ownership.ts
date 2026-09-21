import { bins, type Bin, type Db, type User } from '@wi/db';
import { eq } from 'drizzle-orm';

/**
 * Loads a bin the caller is allowed to see.
 *
 * Returns the bin when `user` owns it, and null otherwise, including when it
 * does not exist. A caller cannot tell a missing bin from someone else's, so a
 * slug cannot be probed to learn whether it is in use.
 *
 * Capture does not go through here, so a provider posting to a bin needs no
 * session.
 */
export async function loadOwnedBin(db: Db, slug: string, user: User | null): Promise<Bin | null> {
  const [bin] = await db.select().from(bins).where(eq(bins.slug, slug)).limit(1);
  if (!bin || !user || bin.userId !== user.id) return null;
  return bin;
}
