import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { sessions, users, type Db, type User } from '@wi/db';
import { eq, lt } from 'drizzle-orm';

export const COOKIE_NAME = 'wi_session';
const SESSION_DAYS = 30;

/** Hashes a session token the way it is stored, so the raw token never reaches the database. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

/**
 * Checks a password against a stored hash.
 *
 * Returns false rather than throwing when the hash is malformed, so a corrupt
 * row fails the login instead of the whole request.
 */
export async function checkPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * Creates a session and returns the token to send as a cookie.
 *
 * The token is returned once and never stored, only its SHA-256, so a database
 * leak cannot be replayed as a live session.
 */
export async function createSession(db: Db, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

/** Returns the user a session token belongs to, or null when it is unknown or expired. */
export async function userForToken(db: Db, token: string): Promise<User | null> {
  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);

  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return row.user;
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Removes expired sessions. Returns how many were deleted. */
export async function pruneSessions(db: Db): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  return deleted.length;
}
