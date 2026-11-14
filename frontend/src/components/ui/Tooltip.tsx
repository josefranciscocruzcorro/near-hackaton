import { useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface TooltipProps {
  content: ReactNode;
  /** Render-prop so the trigger can wire `aria-describedby`. */
  children: (describedBy: string) => ReactElement;
  side?: 'top' | 'bottom';
  /** Horizontal anchoring. Use `end` for triggers near the right edge so the bubble never leaves the viewport. */
  align?: 'center' | 'start' | 'end';
  className?: string;
}

const ALIGN = {
  center: 'left-1/2 -translate-x-1/2',
  start: 'left-0',
  end: 'right-0',
} as const;

/**
 * CSS-only tooltip shown on hover and keyboard focus; the text is also exposed via aria-describedby
 * (which works even while the bubble is `display: none`). Hidden bubbles take no layout space, so they
 * can never cause horizontal scrolling on small screens.
 */
export function Tooltip({ content, children, side = 'top', align = 'center', className }: TooltipProps) {
  const id = useId();
  return (
    <span className={cn('group/tt relative inline-flex', className)}>
      {children(id)}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 w-max max-w-[min(16rem,calc(100vw-2rem))] rounded-md bg-fg px-2.5 py-1.5 text-xs font-medium text-bg shadow-lg',
          'hidden group-hover/tt:block group-focus-within/tt:block',
          ALIGN[align],
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        )}
      >
        {content}
      </span>
    </span>
  );
}
