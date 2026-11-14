import { ArrowLeft, Bot, Cpu, Hash, ShieldAlert, ShieldHalf, TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useAgentRun, useAgentRuns, useDashboard, useInvalidateAfterRun, usePayees } from '../api/queries';
import type { AgentRun, AgentRunSummary, PolicyOutcome } from '../api/types';
import { QueryView } from '../components/QueryView';
import { ReasoningCard } from '../components/ReasoningCard';
import { RunAgentButton } from '../components/RunAgentButton';
import { DrillBadge, RunCounts } from '../components/RunBits';
import { RunStatusChip } from '../components/StatusChips';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { Money, PageHeader } from '../components/ui/Misc';
import { EmptyState } from '../components/ui/States';
import { useToast } from '../components/ui/Toast';
import { useI18n } from '../i18n';
import { cn } from '../lib/cn';
import { formatDateTime, formatInteger, formatRelative } from '../lib/format';
import { useNow } from '../lib/useNow';

function durationText(run: AgentRunSummary): string | null {
  if (!run.finishedAt) return null;
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`;
}

function RunList({ runs, activeId }: { runs: AgentRunSummary[]; activeId: string | undefined }) {
  const { t, locale } = useI18n();
  const now = useNow();
  return (
    <ul className="divide-y divide-border" aria-label={t('agent.runs')}>
      {runs.map((r) => (
        <li key={r.id}>
          <Link
            to={`/agent/${r.id}`}
            aria-current={r.id === activeId ? 'page' : undefined}
            data-testid="agent-run-item"
            className={cn('block px-4 py-3 hover:bg-surface-2/50', r.id === activeId && 'bg-surface-2')}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-1.5">
                <RunStatusChip status={r.status} />
                {r.trigger === 'RedTeamDrill' ? <DrillBadge /> : null}
              </span>
              <span className="text-xs text-muted">{formatRelative(r.startedAt, now, locale)}</span>
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {t(`trigger.${r.trigger}`)}
            </p>
            <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
              <span>{t('agent.proposedN', { n: r.proposed })}</span>
              <span className="text-accent-strong">{t('agent.allowedN', { n: r.allowed })}</span>
              <span className="text-warning">{t('agent.needsApprovalN', { n: r.needsApproval })}</span>
              <span className="text-danger">{t('agent.blockedN', { n: r.blocked })}</span>
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** What the AI proposed, shown neutrally unless the policy also allowed it (never green next to a red verdict). */
export function ProposalChip({ payNow, outcome, drill }: { payNow: boolean; outcome: PolicyOutcome | null; drill: boolean }) {
  const { t } = useI18n();
  if (drill) {
    return (
      <Chip tone={payNow ? 'danger' : 'neutral'} icon={payNow ? Bot : ShieldAlert} testId="ai-proposal">
        {payNow ? t('drill.attempted') : t('agent.defer')}
      </Chip>
    );
  }
  if (!payNow) {
    return (
      <Chip tone="neutral" icon={ShieldAlert} testId="ai-proposal">
        {t('agent.defer')}
      </Chip>
    );
  }
  return outcome === 'Allow' ? (
    <Chip tone="success" icon={Bot} testId="ai-proposal">
      {t('agent.payNow')}
    </Chip>
  ) : (
    <Chip tone="neutral" icon={Bot} testId="ai-proposal">
      {t('agent.aiProposedPay')}
    </Chip>
  );
}

function RunDetail({ run }: { run: AgentRun }) {
  const { t, locale } = useI18n();
  const payees = usePayees();
  const payeeIdByName = new Map((payees.data ?? []).map((p) => [p.name, p.id]));
  const duration = durationText(run);
  const drill = run.trigger === 'RedTeamDrill';
  return (
    <div className="space-y-4" data-testid="agent-run-detail">
      {drill ? (
        <div className="flex items-start gap-3 rounded-[10px] border border-info/40 bg-info-soft p-4 text-info" data-testid="drill-notice">
          <ShieldHalf aria-hidden className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">{t('drill.noticeTitle')}</p>
            <p className="mt-0.5 text-sm text-fg">{t('drill.noticeBody')}</p>
          </div>
        </div>
      ) : null}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <RunStatusChip status={run.status} />
          {drill ? <DrillBadge /> : null}
          <span className="text-sm text-muted">
            {t(`trigger.${run.trigger}`)} · {formatDateTime(run.startedAt, locale)}
            {duration ? ` · ${duration}` : ''}
          </span>
        </div>
        {run.status === 'Running' ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-info" role="status">
            <Bot aria-hidden className="size-4 animate-pulse-soft" />
            {t('agent.thinking')}
          </p>
        ) : null}
        {run.error ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {run.error}
          </p>
        ) : null}
        <h2 className="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">{t('agent.summary')}</h2>
        <p className="mt-1.5 text-md leading-relaxed whitespace-pre-line">{run.summary ?? (run.status === 'Running' ? '…' : t('agent.noSummary'))}</p>
        <RunCounts run={run} className="mt-4" />
        <details className="mt-4 text-xs text-muted" data-testid="agent-run-technical">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium pointer-fine:min-h-0">{t('agent.technicalDetails')}</summary>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            <div className="flex items-center gap-1.5">
              <Cpu aria-hidden className="size-3.5" />
              <dt>{t('agent.model')}</dt>
              <dd className="num text-fg">{run.model ?? '—'}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <Hash aria-hidden className="size-3.5" />
              <dt>{t('agent.tokens')}</dt>
              <dd className="num text-fg">
                {t('agent.tokensValue', {
                  prompt: formatInteger(run.promptTokens, locale),
                  completion: formatInteger(run.completionTokens, locale),
                })}
              </dd>
            </div>
          </dl>
        </details>
      </Card>

      <h2 className="text-md font-semibold">{t('agent.decisions', { count: run.decisions.length })}</h2>
      {run.decisions.length === 0 ? (
        <Card>
          <EmptyState icon={Bot} title={run.status === 'Running' ? t('agent.waitingDecisions') : t('agent.noDecisions')} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {run.decisions.map((d) => (
            <li key={d.billId}>
              <ReasoningCard
                aiReason={d.aiReason}
                outcome={d.policyOutcome}
                reasons={d.policyReasons}
                payeeId={drill ? null : (payeeIdByName.get(d.payeeName) ?? null)}
                header={
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{d.payeeName}</p>
                      <p className="num text-xs text-muted">{d.billReference}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Money value={d.amountUsd} className="font-semibold" />
                      <ProposalChip payNow={d.payNow} outcome={d.policyOutcome} drill={drill} />
                    </div>
                  </div>
                }
                actions={
                  drill ? (
                    <span className="text-xs text-muted">{t('drill.noPayment')}</span>
                  ) : d.paymentId ? (
                    <Link to={`/payments/${d.paymentId}`} className="text-sm font-medium text-accent-strong hover:underline">
                      {t('agent.viewPayment')}
                    </Link>
                  ) : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Watches a run until it leaves Running, then refreshes dependent data and announces the result. */
function useRunCompletion(run: AgentRun | undefined) {
  const { t } = useI18n();
  const { toast } = useToast();
  const invalidate = useInvalidateAfterRun();
  const prev = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!run) return;
    const before = prev.current;
    prev.current = run.status;
    if (before === 'Running' && run.status !== 'Running') {
      invalidate(run);
      toast(
        run.status === 'Completed'
          ? {
              title: t('agent.finished'),
              description: t('agent.finishedBody', { allowed: run.allowed, needsApproval: run.needsApproval, blocked: run.blocked }),
              tone: 'success',
            }
          : { title: t('agent.failed'), description: run.error ?? undefined, tone: 'error' },
      );
    }
  }, [run, invalidate, toast, t]);
}

function RunDetailContainer({ id }: { id: string }) {
  const query = useAgentRun(id);
  useRunCompletion(query.data);
  return <QueryView query={query}>{(run) => <RunDetail run={run} />}</QueryView>;
}

export function AgentPage() {
  const { t } = useI18n();
  const { runId } = useParams();
  const runs = useAgentRuns();
  const dashboard = useDashboard();
  const agentDisabled = dashboard.data ? !dashboard.data.agentEnabled : false;
  // On wide screens the detail pane is always visible: open the latest run instead of an empty pane.
  const wide = useMediaQuery('(min-width: 1024px)');
  const latestId = runs.data?.[0]?.id;
  const shownId = runId ?? (wide ? latestId : undefined);

  return (
    <>
      <PageHeader
        title={t('agent.title')}
        description={t('agent.subtitle')}
        actions={<RunAgentButton disabledReason={agentDisabled ? t('agent.disabledByPolicy') : null} />}
      />
      <div className="-mt-2 mb-5 flex flex-col gap-2 rounded-[10px] border border-border bg-surface p-3 sm:flex-row sm:items-center sm:gap-4" data-testid="drill-row">
        <RunAgentButton mode="RedTeamDrill" variant="secondary" />
        <p className="flex min-w-0 items-start gap-1.5 text-sm text-muted">
          <ShieldHalf aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('drill.explain')}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className={cn('overflow-hidden self-start', runId && 'hidden lg:block')}>
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">{t('agent.runs')}</h2>
          <QueryView query={runs} className="p-4">
            {(list) =>
              list.length === 0 ? (
                <EmptyState icon={Bot} title={t('agent.noRuns')} description={t('agent.noRunsBody')} />
              ) : (
                <RunList runs={list} activeId={shownId} />
              )
            }
          </QueryView>
        </Card>
        <div className={cn('min-w-0', !runId && 'hidden lg:block')}>
          {shownId ? (
            <>
              <Link to="/agent" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted hover:text-fg lg:hidden">
                <ArrowLeft aria-hidden className="size-4" />
                {t('agent.allRuns')}
              </Link>
              <RunDetailContainer key={shownId} id={shownId} />
            </>
          ) : (
            <Card>
              <EmptyState icon={Bot} title={t('agent.selectRun')} description={t('agent.selectRunBody')} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
