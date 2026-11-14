import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { SkeletonList } from './ui/Skeleton';
import { ErrorState } from './ui/States';

interface QueryViewProps<T> {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  loading?: ReactNode;
  className?: string;
}

/** Renders skeleton → error (with retry) → data for a TanStack query. */
export function QueryView<T>({ query, children, loading, className }: QueryViewProps<T>) {
  const { t } = useI18n();
  if (query.isPending) return <>{loading ?? <SkeletonList label={t('common.loading')} className={className} />}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} className={className} />;
  return <>{children(query.data)}</>;
}
