import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkTargetUrl, guardedLookup } from './target-url.js';

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

  it('rejects IPv4 addresses reached through IPv6 tunnelling', async () => {
    const blocked = [
      'http://[64:ff9b::7f00:1]/hook', // NAT64 to 127.0.0.1
      'http://[64:ff9b::a9fe:a9fe]/hook', // NAT64 to 169.254.169.254
      'http://[2002:7f00:1::]/hook', // 6to4 to 127.0.0.1
      'http://[::7f00:1]/hook', // IPv4 compatible
      'http://[fec0::1]/hook', // site local
      'http://198.18.0.1/hook',
      'http://192.0.0.1/hook',
    ];

    for (const target of blocked) {
      expect(await checkTargetUrl(target), target).toMatchObject({ ok: false });
    }
  });

  it('still allows a public address written as IPv6', async () => {
    expect(await checkTargetUrl('http://[2606:4700::6810:85e5]/hook')).toEqual({ ok: true });
    expect(await checkTargetUrl('http://[64:ff9b::5db8:d822]/hook')).toEqual({ ok: true });
  });

  it('refuses a private address at connection time', async () => {
    const refuse = (host: string): Promise<Error | null> =>
      new Promise((resolve) => guardedLookup(host, { all: true }, (error) => resolve(error)));

    expect(await refuse('127.0.0.1')).toBeInstanceOf(Error);
    expect(await refuse('169.254.169.254')).toBeInstanceOf(Error);
    expect(await refuse('93.184.216.34')).toBeNull();

    process.env.FORWARD_ALLOW_PRIVATE = 'true';
    expect(await refuse('127.0.0.1')).toBeNull();
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
