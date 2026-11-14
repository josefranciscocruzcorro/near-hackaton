import { Check, Copy, ExternalLink, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/cn';
import { TONE_CLASSES, type Tone } from '../../lib/status';

/** Copies `value` and flips to a "Copied" state for 1.5 s. */
export function useCopy(value: string) {
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
  return { copied, copy: () => void copy() };
}

interface CopyBlockProps {
  /** Visible label above the value. */
  label: ReactNode;
  value: string;
  /** What is copied, for the button's accessible name (e.g. "deposit address"). */
  what: string;
  testId?: string;
  /** Larger mono text for addresses people must check character by character. */
  large?: boolean;
  className?: string;
}

/** The full value (never truncated, wraps on phones) with a labelled copy button. */
export function CopyBlock({ label, value, what, testId, large, className }: CopyBlockProps) {
  const { t } = useI18n();
  const { copied, copy } = useCopy(value);
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="mt-1 flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-2 pl-3">
        <code className={cn('num min-w-0 flex-1 self-center break-all', large ? 'text-base' : 'text-sm')} data-testid={testId}>
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? t('common.copied') : t('common.copyValue', { what })}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm font-medium hover:bg-surface-2 pointer-fine:min-h-8"
        >
          {copied ? <Check aria-hidden className="size-4 text-accent-strong" /> : <Copy aria-hidden className="size-4" />}
          <span aria-hidden>{copied ? t('common.copied') : t('treasury.copy')}</span>
        </button>
      </div>
    </div>
  );
}

/** A command shown in full, monospaced and wrapped, with a copy button. */
export function CommandBlock({ command, what, testId }: { command: string; what: string; testId?: string }) {
  const { t } = useI18n();
  const { copied, copy } = useCopy(command);
  return (
    <div className="relative min-w-0 rounded-lg border border-border bg-surface-2">
      <pre className="num overflow-x-auto p-3 pr-24 text-xs leading-relaxed break-all whitespace-pre-wrap" data-testid={testId}>
        {command}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? t('common.copied') : t('common.copyValue', { what })}
        className="absolute top-1.5 right-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm font-medium hover:bg-surface-2 pointer-fine:min-h-8"
      >
        {copied ? <Check aria-hidden className="size-4 text-accent-strong" /> : <Copy aria-hidden className="size-4" />}
        <span aria-hidden>{copied ? t('common.copied') : t('treasury.copy')}</span>
      </button>
    </div>
  );
}

/** External link that always opens in a new tab and says so to screen readers. */
export function ExtLink({ href, children, className, testId }: { href: string; children: ReactNode; className?: string; testId?: string }) {
  const { t } = useI18n();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      className={cn(
        'inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent-strong hover:underline pointer-fine:min-h-0',
        className,
      )}
    >
      {children}
      <ExternalLink aria-hidden className="size-3.5 shrink-0" />
      <span className="sr-only">{t('common.newTab')}</span>
    </a>
  );
}

interface CalloutProps {
  tone: Tone;
  icon: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  testId?: string;
  role?: 'alert' | 'status';
}

/** Tinted message box: icon + text, never colour alone. */
export function Callout({ tone, icon: Icon, title, children, className, testId, role }: CalloutProps) {
  return (
    <div role={role} data-testid={testId} data-tone={tone} className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm', TONE_CLASSES[tone], className)}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-fg/90 [&_a]:text-current">{children}</div> : null}
      </div>
    </div>
  );
}

/** Numbered how-to list. */
export function Steps({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ol className={cn('space-y-1.5 text-sm', className)}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="num mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold">
            {i + 1}
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}
