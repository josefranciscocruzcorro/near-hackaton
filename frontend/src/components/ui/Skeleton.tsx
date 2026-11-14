import { cn } from '../../lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse-soft rounded-md bg-surface-2', className)} />;
}

/** Accessible loading block: announces "Loading…" once, renders shimmering rows. */
export function SkeletonList({ rows = 5, label, className }: { rows?: number; label: string; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cn('space-y-3', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
