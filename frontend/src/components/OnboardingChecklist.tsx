import { ArrowRight, CircleCheck, Circle, Rocket, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { usePayees, usePolicy, useTreasury, useUsers } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';
import { cn } from '../lib/cn';
import { buttonClasses } from './ui/Button';
import { Card } from './ui/Card';
import { Meter } from './ui/Misc';

export const ONBOARDING_DISMISSED_KEY = 'tesorero.onboarding.dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveDismissed(): void {
  try {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
  } catch {
    // Storage blocked: it stays hidden for this visit only.
  }
}

export type OnboardingItemId = 'team' | 'payee' | 'policies' | 'treasury' | 'fund' | 'live';

interface Item {
  id: OnboardingItemId;
  done: boolean;
  to: string;
}

/**
 * "Getting started" for real organizations: computed from existing endpoints plus
 * `GET /api/treasury`. Hidden on the demo, once everything is done, or after it is dismissed.
 */
export function OnboardingChecklist() {
  const { t } = useI18n();
  const { can } = useAuth();
  const isOwner = can('users.manage');
  const treasury = useTreasury();
  const payees = usePayees();
  const policy = usePolicy();
  const users = useUsers(isOwner);
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed || !treasury.data || treasury.data.demo) return null;
  if (payees.isPending || policy.isPending || (isOwner && users.isPending)) return null;

  const tr = treasury.data;
  const ok = (id: string) => tr.checks.some((c) => c.id === id && c.ok);
  const items: Item[] = [
    // A non-Owner viewing this means the Owner already invited someone.
    { id: 'team', done: isOwner ? (users.data?.filter((u) => u.isActive).length ?? 0) > 1 : true, to: '/users' },
    { id: 'payee', done: (payees.data?.length ?? 0) > 0, to: '/payees' },
    // The seeded policy is version 1: saving it once means it was reviewed.
    { id: 'policies', done: (policy.data?.version ?? 1) > 1, to: '/policies' },
    { id: 'treasury', done: tr.setup?.status === 'Ready' || ok('contract'), to: '/treasury' },
    { id: 'fund', done: ok('funded') || (tr.balances?.treasuryUsdc ?? 0) > 0, to: '/treasury?fund=1' },
    { id: 'live', done: tr.executionMode === 'Live', to: '/settings' },
  ];
  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) return null;
  const next = items.find((i) => !i.done)?.id;
  const progress = t('onboarding.progress', { done: doneCount, total: items.length });

  return (
    <Card role="region" aria-labelledby="onboarding-title" data-testid="onboarding-checklist" className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="onboarding-title" className="flex items-center gap-2 text-md font-semibold">
            <Rocket aria-hidden className="size-5 shrink-0 text-accent-strong" />
            {t('onboarding.title')}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{isOwner ? t('onboarding.subtitle') : t('onboarding.readOnly')}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            saveDismissed();
            setDismissed(true);
          }}
          aria-label={t('onboarding.dismiss')}
          className="-mt-1 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg pointer-fine:size-9"
          data-testid="onboarding-dismiss"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Meter value={doneCount} max={items.length} label={t('onboarding.title')} valueText={progress} className="flex-1" />
        <span className="num shrink-0 text-xs text-muted" data-testid="onboarding-progress">
          {progress}
        </span>
      </div>
      <ol className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item, i) => (
          <li
            key={item.id}
            data-testid={`onboarding-item-${item.id}`}
            data-done={item.done}
            className={cn('flex min-w-0 items-start gap-3 rounded-[10px] border p-3', item.id === next ? 'border-accent/50 bg-accent-soft/40' : 'border-border')}
          >
            {item.done ? (
              <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-accent-strong" />
            ) : (
              <Circle aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
            )}
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm font-medium', item.done && 'text-muted line-through decoration-muted/60')}>
                <span className="sr-only">{i + 1}. </span>
                {t(`onboarding.${item.id}.title`)}
                <span className="sr-only"> ({item.done ? t('onboarding.done') : t('onboarding.pending')})</span>
              </p>
              {item.done ? null : <p className="mt-0.5 text-xs text-muted">{t(`onboarding.${item.id}.body`)}</p>}
              {!item.done && isOwner ? (
                <Link
                  to={item.to}
                  className={cn(buttonClasses(item.id === next ? 'primary' : 'secondary', 'sm'), 'mt-2')}
                  data-testid={`onboarding-cta-${item.id}`}
                >
                  {t(`onboarding.${item.id}.cta`)}
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
