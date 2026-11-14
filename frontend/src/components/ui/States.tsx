import { AlertTriangle, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/cn';
import { Button } from './Button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-surface-2 text-muted">
        <Icon aria-hidden className="size-6" />
      </div>
      <p className="text-md font-semibold">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const { t } = useI18n();
  const status = error instanceof ApiError ? error.status : null;
  const message =
    status === 403 ? t('error.forbidden') : status === 0 ? t('error.network') : errorMessage(error, t('error.generic'));
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle aria-hidden className="size-6" />
      </div>
      <p className="text-md font-semibold">{t('error.title')}</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>
      {onRetry ? (
        <Button className="mt-4" icon={RefreshCw} onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}
