import { describe, expect, it } from 'vitest';
import {
  daysUntil,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelative,
  formatUsd,
  formatUsdc,
  fromBaseUnits,
  hoursSince,
  parseDateOnly,
  ratio,
  todayIso,
  truncateMiddle,
} from './format';

describe('money', () => {
  it('formats USD with exactly two decimals', () => {
    expect(formatUsd(1250.5)).toBe('$1,250.50');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(4900)).toBe('$4,900.00');
  });

  it('formats USD for Spanish (Ecuador) with local separators', () => {
    const s = formatUsd(1250.5, 'es-EC');
    expect(s).toContain('1.250,50');
    expect(s).toContain('$');
  });

  it('formats USDC and plain numbers', () => {
    expect(formatUsdc(1250.5)).toBe('1,250.50 USDC');
    expect(formatNumber(1.23456, 'en-US', 4)).toBe('1.2346');
  });

  it('converts base units without floating point loss', () => {
    expect(fromBaseUnits('1250500000', 6)).toBe('1250.5');
    expect(fromBaseUnits('1', 6)).toBe('0.000001');
    expect(fromBaseUnits('1000000', 6)).toBe('1');
    expect(fromBaseUnits('0', 6)).toBe('0');
    expect(fromBaseUnits('12345678901234567890', 18)).toBe('12.34567890123456789');
    expect(fromBaseUnits('not-a-number', 6)).toBe('not-a-number');
  });
});

describe('addresses', () => {
  it('truncates long values in the middle', () => {
    expect(truncateMiddle('0x9f1c4b7e2a8d3f6c0e5b9a1d7c2e4f8a6b3ddead')).toBe('0x9f1c…dead');
    expect(truncateMiddle('0x9f1c4b7e2a8d3f6c0e5b9a1d7c2e4f8a6b3ddead', 10, 6)).toBe('0x9f1c4b7e…3ddead');
  });

  it('keeps short values intact', () => {
    expect(truncateMiddle('acme.near')).toBe('acme.near');
  });
});

describe('dates', () => {
  it('parses yyyy-MM-dd as a local calendar date (no UTC off-by-one)', () => {
    const d = parseDateOnly('2026-11-14');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(10);
    expect(d?.getDate()).toBe(14);
    expect(parseDateOnly('14/11/2026')).toBeNull();
  });

  it('formats date-only values', () => {
    expect(formatDate('2026-11-14')).toBe('Nov 14, 2026');
  });

  it('computes days until a due date', () => {
    const now = new Date(2026, 10, 13, 18, 30);
    expect(daysUntil('2026-11-13', now)).toBe(0);
    expect(daysUntil('2026-11-16', now)).toBe(3);
    expect(daysUntil('2026-11-10', now)).toBe(-3);
  });

  it('formats relative time', () => {
    const now = Date.parse('2026-11-13T12:00:00Z');
    expect(formatRelative('2026-11-13T09:00:00Z', now)).toBe('3 hours ago');
    expect(formatRelative('2026-11-15T12:00:00Z', now)).toBe('in 2 days');
  });

  it('computes whole hours since a timestamp, never negative', () => {
    const now = Date.parse('2026-11-13T12:00:00Z');
    expect(hoursSince('2026-11-13T09:30:00Z', now)).toBe(2);
    expect(hoursSince('2026-11-13T13:00:00Z', now)).toBe(0);
    expect(hoursSince('garbage', now)).toBe(Number.POSITIVE_INFINITY);
  });

  it('returns today as yyyy-MM-dd', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('ratios', () => {
  it('clamps to [0, 1] and handles zero limits', () => {
    expect(ratio(50, 200)).toBe(0.25);
    expect(ratio(300, 200)).toBe(1);
    expect(ratio(-5, 200)).toBe(0);
    expect(ratio(0, 0)).toBe(0);
    expect(ratio(1, 0)).toBe(1);
    expect(formatPercent(0.25)).toBe('25%');
  });
});
