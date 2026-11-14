import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { TONE_CLASSES, type Tone } from '../../lib/status';

interface ChipProps {
  tone: Tone;
  icon?: LucideIcon;
  spin?: boolean;
  children: ReactNode;
  className?: string;
  testId?: string;
  title?: string;
}

/** Status chip: always icon + text, never colour alone. */
export function Chip({ tone, icon: Icon, spin, children, className, testId, title }: ChipProps) {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      title={title}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden className={cn('size-3.5 shrink-0', spin && 'animate-spin')} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
