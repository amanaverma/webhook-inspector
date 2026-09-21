import { describe, expect, it } from 'vitest';
import { assertApiConfig, loadConfig } from './config.js';

const base = { DATABASE_URL: 'postgres://wi:wi@localhost:5433/webhook_inspector' };

describe('trust proxy configuration', () => {
  it('trusts nothing when unset', () => {
    expect(loadConfig({ ...base }).trustProxy).toBe(false);
  });

  it('keeps the proxy addresses it is given', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8, loopback' }).trustProxy).toBe('10.0.0.0/8, loopback');
    expect(loadConfig({ ...base, TRUST_PROXY: '2001:db8::1' }).trustProxy).toBe('2001:db8::1');
  });

  it('treats false as off', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: 'false' }).trustProxy).toBe(false);
  });

  it('refuses settings that would trust the caller or nothing at all', () => {
    for (const value of ['true', '1', '2']) {
      expect(() => loadConfig({ ...base, TRUST_PROXY: value }), value).toThrow(/addresses or ranges/);
    }
  });

  it('refuses an entry that is not an address', () => {
    expect(() => loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8,nginx' })).toThrow(/nginx/);
  });
});

describe('production configuration', () => {
  const production = {
    ...base,
    NODE_ENV: 'production',
    REDIS_URL: 'redis://localhost:6380',
    METRICS_TOKEN: 'a-token',
  };

  it('accepts a complete production environment', () => {
    expect(loadConfig(production).production).toBe(true);
  });

  it('refuses to forward to private addresses', () => {
    expect(() => loadConfig({ ...production, FORWARD_ALLOW_PRIVATE: 'true' })).toThrow(/FORWARD_ALLOW_PRIVATE/);
  });

  it('refuses to serve without rate limits or a metrics token', () => {
    const { REDIS_URL: _redis, ...noRedis } = production;
    const { METRICS_TOKEN: _token, ...noToken } = production;

    expect(() => assertApiConfig(loadConfig(noRedis), noRedis)).toThrow(/REDIS_URL/);
    expect(() => assertApiConfig(loadConfig(noToken), noToken)).toThrow(/METRICS_TOKEN/);
  });

  it('lets a worker run without either, since it serves neither', () => {
    const { REDIS_URL: _redis, METRICS_TOKEN: _token, ...worker } = production;

    expect(loadConfig(worker).production).toBe(true);
  });

  it('leaves development alone', () => {
    expect(loadConfig({ ...base, FORWARD_ALLOW_PRIVATE: 'true' }).production).toBe(false);
  });
});
