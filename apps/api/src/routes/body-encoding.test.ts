import { describe, expect, it } from 'vitest';
import { encodeBody } from './body-encoding.js';

describe('encodeBody', () => {
  it('returns text for textual content types', () => {
    for (const type of ['application/json', 'text/plain; charset=utf-8', 'application/vnd.api+json',
      'application/x-www-form-urlencoded', 'text/html']) {
      expect(encodeBody(Buffer.from('{"a":1}'), type), type).toEqual({ body: '{"a":1}', bodyEncoding: 'utf8' });
    }
  });

  it('keeps multibyte characters intact', () => {
    expect(encodeBody(Buffer.from('héllo → 世界'), 'text/plain')).toEqual({
      body: 'héllo → 世界',
      bodyEncoding: 'utf8',
    });
  });

  it('uses base64 for binary content types', () => {
    const bytes = Buffer.from([0x00, 0xff, 0x10]);
    expect(encodeBody(bytes, 'application/octet-stream')).toEqual({
      body: bytes.toString('base64'),
      bodyEncoding: 'base64',
    });
  });

  it('uses base64 when a textual type carries invalid UTF-8', () => {
    const bytes = Buffer.from([0xff, 0xfe, 0xfd]);
    expect(encodeBody(bytes, 'application/json')).toEqual({
      body: bytes.toString('base64'),
      bodyEncoding: 'base64',
    });
  });

  it('uses base64 when there is no content type', () => {
    expect(encodeBody(Buffer.from('plain'), null).bodyEncoding).toBe('base64');
  });

  it('returns an empty string for an empty body', () => {
    expect(encodeBody(Buffer.alloc(0), 'application/json')).toEqual({ body: '', bodyEncoding: 'utf8' });
  });
});
