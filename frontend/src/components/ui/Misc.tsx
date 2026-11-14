import { Check, Copy } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/cn';
import { formatUsd, ratio, truncateMiddle } from '../../lib/format';

// ---------- Money ----------

/** USD amount in mono tabular numerals. */
export function Money({ value, className }: { value: number; className?: string }) {
  const { locale } = useI18n();
  return <span className={cn('num whitespace-nowrap', className)}>{formatUsd(value, locale)}</span>;
}

// ---------- Address ----------

interface AddressProps {
  value: string;
  head?: number;
  tail?: number;
  className?: string;
  /** Accessible name of what is copied, e.g. "recipient address". */
  label?: string;
}

/** Address/hash truncated in the middle, full value in title, with a copy button. */
export function Address({ value, head = 6, tail = 4, className, label }: AddressProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <span className={cn('inline-flex max-w-full min-w-0 items-center gap-0.5', className)}>
      <span className="num truncate text-sm" title={value}>
        {truncateMiddle(value, head, tail)}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? t('common.copied') : t('common.copyValue', { what: label ?? t('common.address') })}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg pointer-fine:size-7"
      >
        {copied ? <Check aria-hidden className="size-3.5 text-accent-strong" /> : <Copy aria-hidden className="size-3.5" />}
      </button>
    </span>
  );
}

// ---------- Meter ----------

interface MeterProps {
  value: number;
  max: number;
  label: string;
  /** Human readable value, e.g. "$1,200 of $5,000". */
  valueText: string;
  className?: string;
}

/** Usage meter that turns amber at 80% and red at 100%. */
export function Meter({ value, max, label, valueText, className }: MeterProps) {
  const r = ratio(value, max);
  const tone = r >= 1 ? 'bg-danger' : r >= 0.8 ? 'bg-warning' : 'bg-accent';
  const safeMax = Math.max(max, 0);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Math.min(Math.max(value, 0), safeMax)}
      aria-valuetext={valueText}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-2', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-200', tone)} style={{ width: `${r * 100}%` }} />
    </div>
  );
}

// ---------- Page header ----------

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// ---------- Segmented filter ----------

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}

/** Filter pills (toggle buttons with aria-pressed); wraps instead of scrolling horizontally. */
export function Segmented<T extends string>({ label, value, options, onChange, className }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors pointer-fine:min-h-8',
              active ? 'border-fg bg-fg text-bg' : 'border-border bg-surface text-muted hover:text-fg',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Definition list rows ----------

export function DetailRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-3 py-2">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}
