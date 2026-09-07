const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded)|application\/[\w.+-]+\+(json|xml))/i;

/**
 * Decides how a stored body should be sent to a client.
 *
 * Returns the body as a string when the content type is textual and the bytes
 * are valid UTF-8, and base64 otherwise.
 *
 * The bytes are checked rather than trusted, because a provider that labels a
 * gzip payload `application/json` would otherwise get mangled text back.
 */
export function encodeBody(
  body: Buffer,
  contentType: string | null,
): { body: string; bodyEncoding: 'utf8' | 'base64' } {
  if (contentType && TEXT_TYPES.test(contentType)) {
    try {
      return { body: new TextDecoder('utf-8', { fatal: true }).decode(body), bodyEncoding: 'utf8' };
    } catch {
      // Falls through to base64 below.
    }
  }

  return { body: body.toString('base64'), bodyEncoding: 'base64' };
}
