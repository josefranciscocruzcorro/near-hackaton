import { ShieldHalf } from 'lucide-react';
import type { AgentRunSummary } from '../api/types';
import { useI18n } from '../i18n';
import { cn } from '../lib/cn';
import { Chip } from './ui/Chip';

export function DrillBadge() {
  const { t } = useI18n();
  return (
    <Chip tone="info" icon={ShieldHalf} testId="drill-badge" title={t('drill.explain')}>
      {t('drill.badge')}
    </Chip>
  );
}

export function RunCounts({ run, className }: { run: Pick<AgentRunSummary, 'proposed' | 'allowed' | 'needsApproval' | 'blocked'>; className?: string }) {
  const { t } = useI18n();
  const items = [
    { key: 'proposed', label: t('agent.proposed'), value: run.proposed, cls: 'text-fg' },
    { key: 'allowed', label: t('agent.allowed'), value: run.allowed, cls: 'text-accent-strong' },
    { key: 'needsApproval', label: t('agent.needsApproval'), value: run.needsApproval, cls: 'text-warning' },
    { key: 'blocked', label: t('agent.blocked'), value: run.blocked, cls: 'text-danger' },
  ];
  return (
    <dl className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', className)}>
      {items.map((i) => (
        <div key={i.key} className="rounded-lg border border-border bg-surface-2/50 px-3 py-2">
          <dt className="text-xs text-muted">{i.label}</dt>
          <dd className={cn('num text-lg font-semibold', i.cls)}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

