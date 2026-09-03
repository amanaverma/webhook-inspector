import { describe, expect, it } from 'vitest';
import { generateSlug } from './slug.js';

describe('generateSlug', () => {
  it('returns the requested length from the safe alphabet', () => {
    expect(generateSlug()).toMatch(/^[a-hj-km-np-z2-9]{10}$/);
    expect(generateSlug(4)).toHaveLength(4);
  });

  it('does not repeat across many draws', () => {
    const slugs = new Set(Array.from({ length: 500 }, () => generateSlug()));
    expect(slugs.size).toBe(500);
  });
});
