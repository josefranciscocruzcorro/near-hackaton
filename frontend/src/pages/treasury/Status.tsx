import { ArrowRight, CircleCheck, CirclePause, CircleX, ListChecks, Radio, ShieldCheck, Vault, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { TREASURY_CHECK_IDS, type TreasuryCheck, type TreasuryOverview } from '../../api/types';
import { buttonClasses } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Meter, Money } from '../../components/ui/Misc';
import { useI18n, type TFunction } from '../../i18n';
import { cn } from '../../lib/cn';
import { formatNumber, formatRelative, formatUsd } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { Callout } from './bits';

function Balance({ label, value, unit, decimals, hint, testId, big }: { label: string; value: number | null; unit: string; decimals: number; hint: string; testId: string; big?: boolean }) {
  const { locale } = useI18n();
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd>
        <p className={cn('num font-semibold tracking-tight', big ? 'text-2xl sm:text-3xl' : 'text-xl')} data-testid={testId}>
          {value === null ? '—' : formatNumber(value, locale, decimals)}{' '}
          <span className="ml-0.5 text-sm font-medium text-muted">{unit}</span>
        </p>
        <p className="mt-0.5 text-xs text-muted">{hint}</p>
      </dd>
    </div>
  );
}

const isKnownCheck = (c: TreasuryCheck) => (TREASURY_CHECK_IDS as readonly string[]).includes(c.id);

/** Label that reads true in each state ("Not paused" / "Paused: no payment can leave"). */
function checkLabel(t: TFunction, c: TreasuryCheck): string {
  if (c.id === 'notPaused' && !c.ok) return t('treasury.check.notPaused.labelFailed');
  if (c.id === 'reserveCovered' && !c.ok) return t('treasury.check.reserveCovered.labelFailed');
  return t(`treasury.check.${c.id}.label`);
}

/** What the check means right now: a frozen treasury must not read "accepts payments". */
function checkMeaning(t: TFunction, c: TreasuryCheck): string {
  if (c.id === 'notPaused' && !c.ok) return t('treasury.check.notPaused.meaningFailed');
  return t(`treasury.check.${c.id}.meaning`);
}

const fixLink = 'inline-flex min-h-11 items-center gap-1 font-semibold text-accent-strong underline-offset-2 hover:underline pointer-fine:min-h-0';

function CheckFix({ id }: { id: TreasuryCheck['id'] }) {
  const { t } = useI18n();
  if (id === 'reserveCovered') {
    return (
      <>
        {t('treasury.checks.whatToDo')} {t('treasury.check.reserveCovered.fix')}{' '}
        <span className="flex flex-wrap gap-x-4">
          <Link to="/policies#minReserveUsd" className={fixLink} data-testid="check-reserveCovered-policies">
            {t('treasury.check.reserveCovered.policiesLink')}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
          <Link to="/treasury?fund=1" className={fixLink} data-testid="check-reserveCovered-fund">
            {t('treasury.check.reserveCovered.fundLink')}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </span>
      </>
    );
  }
  return (
    <>
      {t('treasury.checks.whatToDo')} {t(`treasury.check.${id}.fix`)}
    </>
  );
}

function ChecksList({ checks }: { checks: TreasuryCheck[] }) {
  const { t } = useI18n();
  return (
    <ul className="divide-y divide-border" data-testid="treasury-checks" aria-label={t('treasury.checks.title')}>
      {checks.filter(isKnownCheck).map((c) => (
        <li key={c.id} className="flex items-start gap-3 py-3" data-testid={`check-${c.id}`} data-ok={c.ok}>
          {c.ok ? (
            <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-accent-strong" />
          ) : (
            <CircleX aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium" data-testid={`check-${c.id}-label`}>
              {checkLabel(t, c)}
              <span className="sr-only">: {c.ok ? t('treasury.checks.ok') : t('treasury.checks.failed')}</span>
            </p>
            <p className="text-sm text-muted" data-testid={`check-${c.id}-meaning`}>
              {checkMeaning(t, c)}
            </p>
            {c.ok ? null : (
              <div className="mt-1 text-sm font-medium text-danger" data-testid={`check-${c.id}-fix`}>
                <CheckFix id={c.id} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Balances, on-chain limits and the readiness checklist for the saved treasury account. */
export function StatusCard({ data }: { data: TreasuryOverview }) {
  const { t, locale } = useI18n();
  const now = useNow();
  const b = data.balances;
  const guard = data.onChain;
  const failed = data.checks.filter((c) => !c.ok).length;
  const spentText = guard ? t('overview.ofLimit', { spent: formatUsd(guard.spentToday, locale), limit: formatUsd(guard.dailyLimit, locale) }) : '';
  return (
    <Card role="region" aria-labelledby="treasury-status-title" data-testid="treasury-status">
      <CardHeader
        id="treasury-status-title"
        title={t('treasury.status.title')}
        description={b ? t('treasury.status.readAt', { when: formatRelative(b.readAt, now, locale) }) : t('treasury.status.subtitle')}
        action={
          data.executionMode === 'Live' ? (
            <Chip tone="warning" icon={Radio} testId="treasury-mode">
              {t('mode.Live')}
            </Chip>
          ) : (
            <Chip tone="info" icon={ShieldCheck} testId="treasury-mode">
              {t('mode.Simulation')}
            </Chip>
          )
        }
      />
      <div className="space-y-5 p-4 sm:p-5">
        {data.readyForLive && data.executionMode === 'Simulation' ? (
          <div className="rounded-[10px] border border-accent/40 bg-accent-soft p-4" data-testid="treasury-live-cta">
            <p className="flex items-center gap-2 font-semibold text-accent-strong">
              <CircleCheck aria-hidden className="size-5 shrink-0" />
              {t('treasury.live.title')}
            </p>
            <p className="mt-1 text-sm">{t('treasury.live.body')}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              <li>{t('treasury.live.point1')}</li>
              <li>{t('treasury.live.point2')}</li>
              <li>{t('treasury.live.point3')}</li>
            </ul>
            <Link to="/settings" className={buttonClasses('primary', 'md', 'mt-3')} data-testid="treasury-live-link">
              {t('treasury.live.cta')}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        ) : null}

        {b ? (
          <dl className="grid gap-4 sm:grid-cols-3">
            <Balance big label={t('treasury.status.usdc')} value={b.treasuryUsdc} unit="USDC" decimals={2} hint={t('treasury.status.usdcHint')} testId="balance-usdc" />
            <Balance label={t('treasury.status.near')} value={b.treasuryNear} unit="NEAR" decimals={4} hint={t('treasury.status.nearHint')} testId="balance-near" />
            <Balance label={t('treasury.status.agentNear')} value={b.agentNear} unit="NEAR" decimals={4} hint={t('treasury.status.agentNearHint')} testId="balance-agent" />
          </dl>
        ) : (
          <Callout tone="warning" icon={Wallet} testId="balances-unavailable">
            {t('treasury.status.noBalances')}
          </Callout>
        )}

        {guard ? (
          <section aria-labelledby="treasury-limits-title" data-testid="treasury-limits" data-paused={guard.paused}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="treasury-limits-title" className="flex items-center gap-2 font-semibold">
                <Vault aria-hidden className="size-4 text-muted" />
                {t('treasury.limits.title')}
              </h3>
              {guard.paused ? (
                <Chip tone="danger" icon={CirclePause} testId="treasury-paused">
                  {t('guard.paused')}
                </Chip>
              ) : (
                <Chip tone="success" icon={ShieldCheck}>
                  {t('guard.enforced')}
                </Chip>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">{t('treasury.limits.body')}</p>
            {guard.paused ? (
              <Callout tone="danger" icon={CirclePause} className="mt-3">
                {t('treasury.limits.pausedBody')}
              </Callout>
            ) : null}
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <dl className="grid grid-cols-2 gap-3 text-sm">
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
                  <Money value={guard.paused ? 0 : guard.remainingToday} className="font-semibold" />
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {data.checks.length > 0 ? (
          <section aria-labelledby="treasury-checks-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="treasury-checks-title" className="flex items-center gap-2 font-semibold">
                <ListChecks aria-hidden className="size-4 text-muted" />
                {t('treasury.checks.title')}
              </h3>
              {failed === 0 ? (
                <Chip tone="success" icon={CircleCheck} testId="checks-summary">
                  {t('treasury.checks.allOk')}
                </Chip>
              ) : (
                <Chip tone="warning" icon={CircleX} testId="checks-summary">
                  {t('treasury.checks.someFailed', { count: failed })}
                </Chip>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">{t('treasury.checks.body')}</p>
            <ChecksList checks={data.checks} />
          </section>
        ) : null}
      </div>
    </Card>
  );
}
