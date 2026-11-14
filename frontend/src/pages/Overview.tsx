import {
  ArrowRight,
  Bot,
  CalendarClock,
  CirclePause,
  CreditCard,
  ExternalLink,
  Flag,
  Inbox,
  PiggyBank,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useDashboard } from '../api/queries';
import type { AgentRunSummary, Bill, Dashboard, OnChainGuard, Payment, Treasury } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { OnboardingChecklist } from '../components/OnboardingChecklist';
import { PaymentsSwitchButton } from '../components/PaymentsSwitch';
import { QueryView } from '../components/QueryView';
import { RunAgentButton } from '../components/RunAgentButton';
import { DrillBadge, RunCounts } from '../components/RunBits';
import { PaymentStatusChip, RunStatusChip } from '../components/StatusChips';
import { buttonClasses } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { Address, Meter, Money, PageHeader } from '../components/ui/Misc';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/States';
import { useI18n } from '../i18n';
import { chainName } from '../lib/chains';
import { cn } from '../lib/cn';
import { formatDate, formatNumber, formatPercent, formatRelative, formatUsd, ratio } from '../lib/format';
import { dueLabel } from '../lib/labels';
import { useNow } from '../lib/useNow';

function OverviewSkeleton() {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t('common.loading')} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Skeleton className="h-48 sm:col-span-2 xl:row-span-2 xl:h-auto" />
      <Skeleton className="h-36" />
      <Skeleton className="h-36" />
      <Skeleton className="h-36 sm:col-span-2" />
      <Skeleton className="h-64 sm:col-span-2 xl:col-span-3" />
      <Skeleton className="h-64 sm:col-span-2 xl:col-span-1" />
    </div>
  );
}

function Kpi({ label, icon: Icon, children, className }: { label: string; icon: typeof Wallet; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('flex flex-col p-4 sm:p-5', className)}>
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted">
        <Icon aria-hidden className="size-4" />
        {label}
      </h2>
      <div className="mt-3 flex flex-1 flex-col">{children}</div>
    </Card>
  );
}

function TreasuryCard({ treasury, mode }: { treasury: Treasury; mode: Dashboard['executionMode'] }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const now = useNow();
  return (
    <Kpi label={t('overview.treasury')} icon={Wallet} className="sm:col-span-2 xl:row-span-2">
      {treasury.configured ? (
        <>
          <p className="num text-2xl font-semibold tracking-tight sm:text-3xl" data-testid="treasury-balance">
            {treasury.usdcBalance === null ? '—' : formatNumber(treasury.usdcBalance, locale)}
            <span className="ml-2 text-md font-medium text-muted">USDC</span>
          </p>
          <p className="mt-1 text-sm text-muted">
            {treasury.nearBalance === null ? null : (
              <>
                <span className="num">{formatNumber(treasury.nearBalance, locale, 4)}</span> NEAR ·{' '}
              </>
            )}
            {t('overview.onNetwork', { network: treasury.network })}
          </p>
          <dl className="mt-auto space-y-1 pt-5 text-sm">
            <div className="flex flex-wrap items-center gap-x-2">
              <dt className="text-muted">{t('overview.account')}</dt>
              <dd className="min-w-0">{treasury.accountId ? <Address value={treasury.accountId} head={14} tail={8} label={t('overview.account')} /> : '—'}</dd>
            </div>
            <div className="flex flex-wrap items-center gap-x-2">
              <dt className="text-muted">{t('overview.updated')}</dt>
              <dd>{treasury.updatedAt ? formatRelative(treasury.updatedAt, now, locale) : '—'}</dd>
            </div>
            <div className="flex flex-wrap items-center gap-x-2">
              <dt className="text-muted">{t('overview.mode')}</dt>
              <dd>{t(`mode.${mode}`)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-start" data-testid="treasury-not-configured">
          <p className="text-lg font-semibold">{t('overview.notConfigured')}</p>
          <p className="mt-1 max-w-md text-sm text-muted">{t('overview.notConfiguredBody')}</p>
          {can('settings.edit') ? (
            <Link to="/treasury" className={buttonClasses('secondary', 'sm', 'mt-4')} data-testid="treasury-configure">
              {t('overview.configure')}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          ) : (
            <p className="mt-4 text-xs text-muted">{t('overview.askOwner')}</p>
          )}
        </div>
      )}
    </Kpi>
  );
}

function SpendKpi({ label, spent, limit, icon }: { label: string; spent: number; limit: number; icon: typeof Wallet }) {
  const { t, locale } = useI18n();
  const r = ratio(spent, limit);
  const remaining = Math.max(limit - spent, 0);
  return (
    <Kpi label={label} icon={icon}>
      <p className="num text-xl font-semibold">{formatUsd(spent, locale)}</p>
      <p className="text-xs text-muted">{t('overview.ofLimitShort', { limit: formatUsd(limit, locale) })}</p>
      <Meter
        className="mt-3"
        value={spent}
        max={limit}
        label={label}
        valueText={t('overview.ofLimit', { spent: formatUsd(spent, locale), limit: formatUsd(limit, locale) })}
      />
      <p className="mt-2 text-xs text-muted">
        {t('overview.usedRemaining', { pct: formatPercent(r, locale), remaining: formatUsd(remaining, locale) })}
      </p>
    </Kpi>
  );
}

export const nearblocksAccountUrl = (accountId: string) => `https://nearblocks.io/address/${encodeURIComponent(accountId)}`;

/** Limits enforced by the NEAR treasury contract itself (ADR-0005) — the signature trust element. */
export function OnChainGuardCard({ guard }: { guard: OnChainGuard }) {
  const { t, locale } = useI18n();
  const paused = guard.paused;
  const spentText = t('overview.ofLimit', { spent: formatUsd(guard.spentToday, locale), limit: formatUsd(guard.dailyLimit, locale) });
  return (
    <Card
      className={cn('sm:col-span-2 xl:col-span-4', paused && 'border-danger/50')}
      data-testid="onchain-guard"
      data-paused={paused}
      aria-labelledby="onchain-guard-title"
      role="region"
    >
      <div className="px-4 pt-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 id="onchain-guard-title" className="flex items-center gap-2.5 text-md font-semibold text-fg">
            <ShieldCheck aria-hidden className={cn('size-5 shrink-0', paused ? 'text-danger' : 'text-accent-strong')} />
            {t('guard.title')}
          </h2>
          {paused ? (
            <Chip tone="danger" icon={CirclePause} testId="onchain-guard-status">
              {t('guard.paused')}
            </Chip>
          ) : (
            <Chip tone="success" icon={ShieldCheck} testId="onchain-guard-status">
              {t('guard.enforced')}
            </Chip>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">{t('guard.explainer')}</p>
      </div>
      <div className="px-4 pt-3 pb-4 sm:px-5">
        {paused ? (
          <p
            className="mb-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm font-medium text-danger"
            data-testid="onchain-guard-paused"
          >
            <CirclePause aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('guard.pausedBody')}
          </p>
        ) : null}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <dt className="text-xs text-muted">{t('guard.contract')}</dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-x-1">
                <Address value={guard.contractId} head={14} tail={8} label={t('guard.contract')} />
                <a
                  href={nearblocksAccountUrl(guard.contractId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="onchain-guard-contract-link"
                  className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-accent-strong hover:underline pointer-fine:min-h-0"
                >
                  NearBlocks
                  <ExternalLink aria-hidden className="size-3.5" />
                  <span className="sr-only">{t('common.newTab')}</span>
                </a>
              </dd>
            </div>
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <dt className="text-xs text-muted">{t('guard.agent')}</dt>
              <dd className="min-w-0">
                {guard.agentId ? <Address value={guard.agentId} head={14} tail={8} label={t('guard.agent')} /> : <span className="text-muted">{t('guard.noAgent')}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('guard.maxPerPayment')}</dt>
              <dd>
                <Money value={guard.maxPerPayment} className="font-medium" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">{t('guard.dailyLimit')}</dt>
              <dd>
                <Money value={guard.dailyLimit} className="font-medium" />
              </dd>
            </div>
          </dl>
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{t('guard.spentToday')}</span>
              <span className="num text-xs text-muted">{spentText}</span>
            </div>
            <Meter value={guard.spentToday} max={guard.dailyLimit} label={t('guard.spentToday')} valueText={spentText} />
            <p className="mt-2 text-sm">
              <span className="text-muted">{t('guard.remainingToday')}: </span>
              <Money value={paused ? 0 : guard.remainingToday} className="font-semibold" />
              {paused ? <span className="ml-1 text-xs text-danger">({t('guard.paused')})</span> : null}
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ApprovalsKpi({ count }: { count: number }) {
  const { t } = useI18n();
  return (
    <Kpi label={t('overview.pendingApprovals')} icon={Inbox} className="sm:col-span-2">
      <div className="flex flex-1 flex-wrap items-end justify-between gap-3">
        <div>
          <p className="num text-2xl font-semibold" data-testid="pending-approvals-count">
            {count}
          </p>
          <p className="text-sm text-muted">{count === 0 ? t('overview.noApprovals') : t('overview.approvalsWaiting')}</p>
        </div>
        <Link
          to="/approvals"
          data-testid="overview-approvals-cta"
          className={buttonClasses(count > 0 ? 'primary' : 'secondary', 'md')}
        >
          {count > 0 ? t('overview.reviewNow') : t('overview.openInbox')}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </Kpi>
  );
}

function LastRunCard({ run, agentEnabled }: { run: AgentRunSummary | null; agentEnabled: boolean }) {
  const { t, locale } = useI18n();
  const now = useNow();
  const disabledReason = agentEnabled ? null : t('agent.disabledByPolicy');
  return (
    <Card className="sm:col-span-2 xl:col-span-3">
      <CardHeader
        title={t('overview.lastRun')}
        icon={<Bot aria-hidden className="mt-0.5 size-5 text-muted" />}
        action={<RunAgentButton variant="secondary" disabledReason={disabledReason} />}
      />
      <div className="px-4 pt-3 pb-4 sm:px-5">
        {!agentEnabled ? (
          <p className="mb-3 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            <ShieldAlert aria-hidden className="size-4 shrink-0" />
            {t('agent.disabledByPolicy')}
          </p>
        ) : null}
        {run ? (
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <RunStatusChip status={run.status} />
              {run.trigger === 'RedTeamDrill' ? <DrillBadge /> : null}
              <span className="text-muted">
                {t(`trigger.${run.trigger}`)} · {formatRelative(run.startedAt, now, locale)}
                {run.model ? ` · ${run.model}` : ''}
              </span>
            </div>
            <p className="mt-3 line-clamp-3 text-sm leading-relaxed">{run.summary ?? t('agent.noSummary')}</p>
            <RunCounts run={run} className="mt-4" />
            <Link to={`/agent/${run.id}`} className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent-strong hover:underline pointer-fine:min-h-0">
              {t('overview.viewRun')}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        ) : (
          <EmptyState icon={Bot} title={t('overview.noRuns')} description={t('overview.noRunsBody')} className="py-6" />
        )}
      </div>
    </Card>
  );
}

function BudgetsCard({ budgets }: { budgets: Dashboard['categoryBudgets'] }) {
  const { t, locale } = useI18n();
  return (
    <Card className="sm:col-span-2 xl:col-span-1">
      <CardHeader title={t('overview.budgets')} icon={<PiggyBank aria-hidden className="mt-0.5 size-5 text-muted" />} />
      <div className="px-4 pt-3 pb-4 sm:px-5">
        {budgets.length === 0 ? (
          <EmptyState icon={PiggyBank} title={t('overview.noBudgets')} className="py-6" />
        ) : (
          <ul className="space-y-3.5">
            {budgets.map((b) => {
              const label = t(`category.${b.category}`);
              return (
                <li key={b.category}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{label}</span>
                    <span className={cn('num text-xs', b.spent > b.budget ? 'font-semibold text-danger' : 'text-muted')}>
                      {formatPercent(b.budget > 0 ? b.spent / b.budget : 0, locale)}
                    </span>
                  </div>
                  <Meter
                    value={b.spent}
                    max={b.budget}
                    label={t('overview.budgetFor', { category: label })}
                    valueText={t('overview.ofLimit', { spent: formatUsd(b.spent, locale), limit: formatUsd(b.budget, locale) })}
                  />
                  <p className="num mt-1 text-xs text-muted">
                    {t('overview.ofLimit', { spent: formatUsd(b.spent, locale), limit: formatUsd(b.budget, locale) })}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

function UpcomingBills({ bills }: { bills: Bill[] }) {
  const { t, locale } = useI18n();
  return (
    <Card>
      <CardHeader
        title={t('overview.upcoming')}
        icon={<CalendarClock aria-hidden className="mt-0.5 size-5 text-muted" />}
        action={
          <Link to="/bills" className="inline-flex min-h-11 items-center text-sm font-medium text-accent-strong hover:underline pointer-fine:min-h-0">
            {t('common.viewAll')}
          </Link>
        }
      />
      {bills.length === 0 ? (
        <EmptyState icon={CalendarClock} title={t('overview.noUpcoming')} description={t('overview.noUpcomingBody')} className="py-8" />
      ) : (
        <ul className="divide-y divide-border px-4 pt-2 pb-2 sm:px-5">
          {bills.map((b) => {
            const due = dueLabel(t, b.dueDate);
            return (
              <li key={b.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {b.payeeName}
                    {b.flags.length > 0 ? (
                      <Flag aria-label={t('bills.flagged')} className="size-3.5 shrink-0 text-danger" />
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted">
                    <span className="num">{b.reference}</span> · {formatDate(b.dueDate, locale)}
                  </p>
                </div>
                <div className="text-right">
                  <Money value={b.amountUsd} className="text-sm font-medium" />
                  <p className={cn('text-xs', due.overdue ? 'font-medium text-danger' : due.soon ? 'text-warning' : 'text-muted')}>{due.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function RecentPayments({ payments }: { payments: Payment[] }) {
  const { t, locale } = useI18n();
  const now = useNow();
  return (
    <Card>
      <CardHeader
        title={t('overview.recentPayments')}
        icon={<CreditCard aria-hidden className="mt-0.5 size-5 text-muted" />}
        action={
          <Link to="/payments" className="inline-flex min-h-11 items-center text-sm font-medium text-accent-strong hover:underline pointer-fine:min-h-0">
            {t('common.viewAll')}
          </Link>
        }
      />
      {payments.length === 0 ? (
        <EmptyState icon={CreditCard} title={t('overview.noPayments')} description={t('overview.noPaymentsBody')} className="py-8" />
      ) : (
        <ul className="divide-y divide-border px-4 pt-2 pb-2 sm:px-5">
          {payments.map((p) => (
            <li key={p.id}>
              <Link to={`/payments/${p.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-surface-2/60">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.payeeName}</p>
                  <p className="truncate text-xs text-muted">
                    {p.destinationSymbol} · {chainName(p.destinationChain)} · {formatRelative(p.createdAt, now, locale)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Money value={p.amountUsd} className="text-sm font-medium" />
                  <PaymentStatusChip status={p.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function OverviewPage() {
  const { t } = useI18n();
  const query = useDashboard();
  return (
    <>
      <PageHeader
        title={t('overview.title')}
        description={t('overview.subtitle')}
        actions={<PaymentsSwitchButton hideWhenStopped />}
      />
      <QueryView query={query} loading={<OverviewSkeleton />}>
        {(d) => (
          <div className="space-y-4">
            <OnboardingChecklist />
            {d.pendingApprovals > 0 ? (
              <Link
                to="/approvals"
                className="flex items-center gap-3 rounded-[10px] border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning hover:brightness-[0.98]"
              >
                <Inbox aria-hidden className="size-5 shrink-0" />
                <span className="flex-1 font-medium">{t('overview.banner', { count: d.pendingApprovals })}</span>
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <TreasuryCard treasury={d.treasury} mode={d.executionMode} />
              <SpendKpi label={t('overview.spendToday')} spent={d.spend.today} limit={d.spend.dailyLimit} icon={TrendingUp} />
              <SpendKpi label={t('overview.spendMonth')} spent={d.spend.month} limit={d.spend.monthlyLimit} icon={CalendarClock} />
              <ApprovalsKpi count={d.pendingApprovals} />
              {d.treasury.onChain ? <OnChainGuardCard guard={d.treasury.onChain} /> : null}
              <LastRunCard run={d.lastAgentRun} agentEnabled={d.agentEnabled} />
              <BudgetsCard budgets={d.categoryBudgets} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <UpcomingBills bills={d.upcomingBills} />
              <RecentPayments payments={d.recentPayments} />
            </div>
          </div>
        )}
      </QueryView>
    </>
  );
}
