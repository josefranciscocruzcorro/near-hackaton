import { describe, expect, it } from 'vitest';
import { isValidNearAccountId, isValidSlug, normalizeSlugInput, slugify } from './slug';

describe('slugify()', () => {
  it.each([
    ['Café Andino S.A.', 'cafe-andino-s-a'],
    ['  ACME   Imports  ', 'acme-imports'],
    ['Niño & Peña — Ltda.', 'nino-pena-ltda'],
    ['***', ''],
    ['A very long organization name that keeps on going', 'a-very-long-organization-name'],
  ])('%s → %s', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it('never ends with a hyphen after trimming to 30 characters', () => {
    const slug = slugify('abcdefghijklmnopqrstuvwxyz abc def');
    expect(slug.length).toBeLessThanOrEqual(30);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('subdomain rules', () => {
  it.each([
    ['acme', true],
    ['a1-b2', true],
    ['ab', false],
    ['-acme', false],
    ['acme-', false],
    ['Acme', false],
    ['acme_co', false],
    ['a'.repeat(30), true],
    ['a'.repeat(31), false],
  ])('%s valid=%s', (slug, valid) => {
    expect(isValidSlug(slug)).toBe(valid);
  });

  it('lowercases and turns spaces into hyphens while typing', () => {
    expect(normalizeSlugInput('My Shop')).toBe('my-shop');
  });
});

describe('NEAR account ids', () => {
  it.each([
    ['alice.near', true],
    ['acme-treasury.near', true],
    ['sub.acme.near', true],
    ['a'.repeat(64), true],
    ['Alice.near', false],
    ['alice..near', false],
    ['.near', false],
    ['not valid!', false],
    ['a', false],
  ])('%s valid=%s', (id, valid) => {
    expect(isValidNearAccountId(id)).toBe(valid);
  });
});
