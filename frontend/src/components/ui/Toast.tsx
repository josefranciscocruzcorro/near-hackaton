import { CheckCircle2, Info, OctagonX, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms; 0 keeps it until dismissed. */
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastInput, 'description'>> {
  id: number;
  description?: string;
}

interface ToastValue {
  toast: (input: ToastInput) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

const ICONS = { success: CheckCircle2, error: OctagonX, warning: TriangleAlert, info: Info } as const;
const TONES = {
  success: 'text-accent-strong',
  error: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
} as const;

export function ToastProvider({ children, dismissLabel = 'Dismiss' }: { children: ReactNode; dismissLabel?: string }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    ({ title, description, tone = 'info', duration = 5000 }: ToastInput) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-3), { id, title, description, tone, duration }]);
      if (duration > 0) timers.current.set(id, window.setTimeout(() => dismiss(id), duration));
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  // The region is a manual popover so toasts render in the top layer, above modal <dialog>s.
  // Re-showing it when a toast arrives moves it above any dialog opened since.
  const regionRef = useRef<HTMLDivElement>(null);
  const lastId = items.at(-1)?.id;
  useEffect(() => {
    const el = regionRef.current;
    if (!el || typeof el.showPopover !== 'function') return;
    try {
      if (el.matches(':popover-open')) el.hidePopover();
      el.showPopover();
    } catch {
      // Popover API unsupported: the fixed-position region still works below dialogs.
    }
  }, [lastId]);

  return (
    <ToastContext value={value}>
      {children}
      <div
        ref={regionRef}
        popover="manual"
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 top-auto bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] m-0 flex w-auto flex-col items-center gap-2 overflow-visible border-0 bg-transparent px-4 py-0 lg:right-4 lg:bottom-4 lg:left-auto lg:items-end"
      >
        {items.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <div
              key={t.id}
              data-testid="toast"
              data-tone={t.tone}
              className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-[10px] border border-border bg-surface p-3 shadow-lg"
            >
              <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', TONES[t.tone])} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.description ? <p className="mt-0.5 text-sm break-words text-muted">{t.description}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label={dismissLabel}
                className="-m-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg pointer-fine:size-7"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
