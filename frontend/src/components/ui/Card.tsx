import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[10px] border border-border bg-surface', className)} {...rest} />;
}

interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  as?: 'h2' | 'h3';
  id?: string;
}

export function CardHeader({ title, description, action, icon, as: Heading = 'h2', id }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon}
        <div className="min-w-0">
          <Heading id={id} className="text-md font-semibold text-fg">
            {title}
          </Heading>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
