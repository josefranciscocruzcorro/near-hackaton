import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/cn';

export type DialogVariant = 'center' | 'panel';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * `center`: modal centred on desktop, bottom sheet on mobile.
   * `panel`: right side panel on desktop (≥1024px), bottom sheet on mobile.
   */
  variant?: DialogVariant;
  size?: 'sm' | 'md' | 'lg';
  testId?: string;
}

const SIZES = { sm: 'lg:max-w-md', md: 'lg:max-w-xl', lg: 'lg:max-w-3xl' } as const;

/**
 * Native <dialog> modal: the browser provides focus trapping, inert background, Escape to close
 * and focus restoration. We only add styling, a close button and backdrop-click dismissal.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = 'center',
  size = 'md',
  testId,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const { t } = useI18n();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    const handleClick = (e: MouseEvent) => {
      // Clicks on the ::backdrop are dispatched to the <dialog> element itself.
      if (e.target === el) onCloseRef.current();
    };
    el.addEventListener('cancel', handleCancel);
    el.addEventListener('click', handleClick);
    return () => {
      el.removeEventListener('cancel', handleCancel);
      el.removeEventListener('click', handleClick);
    };
  }, []);

  const panel = variant === 'panel';

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      data-testid={testId}
      className={cn(
        'm-0 bg-transparent p-0 backdrop:animate-fade-in',
        // Mobile: bottom sheet
        'fixed inset-x-0 top-auto bottom-0 w-full max-w-full',
        panel
          ? 'lg:inset-y-0 lg:right-0 lg:left-auto lg:h-dvh lg:max-h-dvh lg:w-[min(560px,100vw)]'
          : cn('lg:inset-0 lg:m-auto lg:h-fit lg:w-[calc(100vw-2rem)]', SIZES[size]),
      )}
    >
      {open ? (
        <div
          className={cn(
            'flex max-h-[92dvh] flex-col border border-border bg-surface text-fg shadow-2xl',
            'animate-slide-up rounded-t-2xl',
            panel
              ? 'lg:animate-slide-left lg:h-dvh lg:max-h-dvh lg:rounded-none lg:border-y-0 lg:border-r-0'
              : 'lg:max-h-[88dvh] lg:rounded-[10px]',
          )}
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border lg:hidden" aria-hidden />
          <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="mt-0.5 text-sm text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg pointer-fine:size-9"
            >
              <X aria-hidden className="size-5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">{children}</div>
          {footer ? (
            <footer className="pb-safe flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 sm:px-5">
              {footer}
            </footer>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
