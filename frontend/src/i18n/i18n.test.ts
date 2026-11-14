import { describe, expect, it } from 'vitest';
import { en } from './en';
import { es } from './es';
import { interpolate, translate } from './index';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();

describe('i18n dictionaries', () => {
  const enKeys = Object.keys(en);
  const esKeys = Object.keys(es);

  it('Spanish defines every English key and nothing extra', () => {
    expect(enKeys.filter((k) => !esKeys.includes(k))).toEqual([]);
    expect(esKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it('has no empty translations', () => {
    for (const [k, v] of Object.entries(es)) expect(v.trim(), k).not.toBe('');
    for (const [k, v] of Object.entries(en)) expect(v.trim(), k).not.toBe('');
  });

  it('keeps the same placeholders in both languages', () => {
    for (const key of enKeys as (keyof typeof en)[]) {
      expect(placeholders(es[key]), key).toEqual(placeholders(en[key]));
    }
  });
});

describe('translate()', () => {
  it('interpolates variables', () => {
    expect(translate('en', 'due.inDays', { count: 3 })).toBe('Due in 3 days');
    expect(translate('es', 'due.inDays', { count: 3 })).toBe('Vence en 3 días');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(interpolate('Hello {name} {missing}', { name: 'Ana' })).toBe('Hello Ana {missing}');
  });

  it('never doubles the period after a value that already ends with one (times like "1:01 p. m.")', () => {
    expect(translate('es', 'payments.decidedBy', { who: 'Ana', when: '14 nov 2026, 1:01 p. m.' })).toBe('Decidido por Ana el 14 nov 2026, 1:01 p. m.');
    expect(translate('en', 'payments.decidedBy', { who: 'Ana', when: 'Nov 14, 2026, 1:01 PM' })).toBe('Decided by Ana on Nov 14, 2026, 1:01 PM.');
  });
});
