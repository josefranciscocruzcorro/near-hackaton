// Formatting helpers. Money is always exact (2 decimals) and rendered with tabular numerals by callers.

const cache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    cache.set(key, f);
  }
  return f;
}

/** `$1,250.50` — USD amount with exactly two decimals. */
export function formatUsd(amount: number, locale = 'en-US'): string {
  return nf(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    amount,
  );
}

/** `$1.2K` style compact USD for tight spaces (axis labels, chips). */
export function formatUsdCompact(amount: number, locale = 'en-US'): string {
  return nf(locale, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(amount);
}

/** `1,250.50` — plain number with fixed decimals. */
export function formatNumber(value: number, locale = 'en-US', decimals = 2): string {
  return nf(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

/** `1,250.50 USDC` */
export function formatUsdc(amount: number, locale = 'en-US'): string {
  return `${formatNumber(amount, locale, 2)} USDC`;
}

/** Integer with grouping, e.g. token counts. */
export function formatInteger(value: number, locale = 'en-US'): string {
  return nf(locale, { maximumFractionDigits: 0 }).format(value);
}

/**
 * Converts a base-unit integer string (e.g. 1Click `amountIn`, 6 decimals for USDC) into a
 * decimal string without floating point loss: `("1250500000", 6)` → `"1250.5"`.
 */
export function fromBaseUnits(raw: string, decimals: number): string {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return trimmed;
  if (decimals <= 0) return trimmed.replace(/^0+(?=\d)/, '');
  const padded = trimmed.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals).replace(/^0+(?=\d)/, '');
  const frac = padded.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/** Shortens long addresses/hashes in the middle: `0x9f1c4b…dead`. */
export function truncateMiddle(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Parses `yyyy-MM-dd` as a local calendar date (avoids the UTC-midnight off-by-one). */
export function parseDateOnly(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

/** `Nov 14, 2026` for a `yyyy-MM-dd` date. */
export function formatDate(value: string, locale = 'en-US'): string {
  const date = parseDateOnly(value) ?? new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

/** `Nov 14, 2026, 10:00` in the viewer's time zone for ISO timestamps. */
export function formatDateTime(iso: string, locale = 'en-US'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.34524],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
];

/** `3 hours ago`, `in 2 days`. A moment ago, or under a minute ahead (clock skew), reads "just now". */
export function formatRelative(iso: string, now: number = Date.now(), locale = 'en-US'): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  let delta = (then - now) / 1000;
  if (delta > -10 && delta < 60) return locale.toLowerCase().startsWith('es') ? 'justo ahora' : 'just now';
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(delta) < size) {
      return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(delta), unit);
    }
    delta /= size;
  }
  return iso;
}

/** Whole hours elapsed since an ISO timestamp (never negative). */
export function hoursSince(iso: string, now: number = Date.now()): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now - then) / 3_600_000));
}

/** Calendar days from today until a `yyyy-MM-dd` date (negative = overdue). */
export function daysUntil(dateOnly: string, now: Date = new Date()): number {
  const due = parseDateOnly(dateOnly);
  if (!due) return 0;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/** Ratio used by progress meters, clamped to [0, 1]. Zero limits count as fully used when spent > 0. */
export function ratio(spent: number, limit: number): number {
  if (limit <= 0) return spent > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, spent / limit));
}

/** `75%` */
export function formatPercent(value: number, locale = 'en-US'): string {
  return nf(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value);
}

/** Today's date as `yyyy-MM-dd` in local time. */
export function todayIso(now: Date = new Date()): string {
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
