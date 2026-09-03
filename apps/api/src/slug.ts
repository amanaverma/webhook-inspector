import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * Returns a random URL safe slug of `length` characters.
 *
 * Characters are drawn from a 31 character alphabet holding no `i`, `l`, `o`,
 * `0` or `1`, so a slug read off a screen cannot be typed back wrong. At the
 * default length there are about 31^10 of them, far too many to guess.
 */
export function generateSlug(length = 10): string {
  const bytes = randomBytes(length);
  let slug = '';
  for (let i = 0; i < length; i += 1) {
    slug += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return slug;
}
