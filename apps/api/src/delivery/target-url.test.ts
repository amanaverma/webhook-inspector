import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkTargetUrl } from './target-url.js';

describe('checkTargetUrl', () => {
  const original = process.env.FORWARD_ALLOW_PRIVATE;

  beforeEach(() => {
    delete process.env.FORWARD_ALLOW_PRIVATE;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.FORWARD_ALLOW_PRIVATE;
    else process.env.FORWARD_ALLOW_PRIVATE = original;
  });

  it('allows a public target', async () => {
    expect(await checkTargetUrl('https://example.com/hook')).toEqual({ ok: true });
  });

  it('rejects loopback, private, link local and metadata addresses', async () => {
    const blocked = [
      'http://127.0.0.1:4000/hook',
      'http://localhost:4000/hook',
      'http://10.0.0.5/hook',
      'http://172.16.4.1/hook',
      'http://192.168.1.10/hook',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/hook',
      'http://[::1]:4000/hook',
      'http://[fd00::1]/hook',
      'http://0.0.0.0/hook',
    ];

    for (const target of blocked) {
      expect(await checkTargetUrl(target), target).toMatchObject({ ok: false });
    }
  });

  it('rejects an IPv4 address written as IPv6', async () => {
    expect(await checkTargetUrl('http://[::ffff:127.0.0.1]/hook')).toMatchObject({ ok: false });
  });

  it('rejects a host that does not resolve', async () => {
    expect(await checkTargetUrl('https://no-such-host.invalid/hook')).toMatchObject({ ok: false });
  });

  it('rejects protocols other than http and https', async () => {
    for (const target of ['file:///etc/passwd', 'gopher://example.com/', 'ftp://example.com/']) {
      expect(await checkTargetUrl(target), target).toMatchObject({ ok: false });
    }
  });

  it('allows private targets when the environment opts in', async () => {
    process.env.FORWARD_ALLOW_PRIVATE = 'true';
    expect(await checkTargetUrl('http://127.0.0.1:4000/hook')).toEqual({ ok: true });
  });
});
