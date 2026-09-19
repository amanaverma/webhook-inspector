import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { DATABASE_URL: 'postgres://wi:wi@localhost:5433/webhook_inspector' };

describe('trust proxy configuration', () => {
  it('trusts nothing when unset', () => {
    expect(loadConfig({ ...base }).trustProxy).toBe(false);
  });

  it('keeps the proxy addresses it is given', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8, loopback' }).trustProxy).toBe('10.0.0.0/8, loopback');
    expect(loadConfig({ ...base, TRUST_PROXY: '2001:db8::1' }).trustProxy).toBe('2001:db8::1');
  });

  it('refuses settings that would trust the caller or nothing at all', () => {
    for (const value of ['true', 'false', '1', '2']) {
      expect(() => loadConfig({ ...base, TRUST_PROXY: value }), value).toThrow(/addresses or ranges/);
    }
  });

  it('refuses an entry that is not an address', () => {
    expect(() => loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8,nginx' })).toThrow(/nginx/);
  });
});
