import { ArrowRight, Clock, HandCoins, ShieldCheck, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { usePolicy } from '../api/queries';
import type { PolicyOutcome, PolicyReason } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useI18n } from '../i18n';

const DEFAULT_COOLDOWN_HOURS = 48;

function StepLink({ to, icon: Icon, children, testId }: { to: string; icon: LucideIcon; children: ReactNode; testId: string }) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-accent-strong hover:bg-surface-2 pointer-fine:min-h-9"
    >
      <Icon aria-hidden className="size-4" />
      {children}
      <ArrowRight aria-hidden className="size-4" />
    </Link>
  );
}

/**
 * What to do about a blocked payment, from the policy reason codes: allow the supplier, lower the
 * reserve or add funds. A new supplier's waiting period is explained (a person approves it).
 */
export function NextSteps({ outcome, reasons, payeeId }: { outcome: PolicyOutcome | null; reasons: PolicyReason[]; payeeId?: string | null }) {
  const codes = new Set(reasons.map((r) => r.code));
  const blocked = outcome === 'Block';
  const relevant = codes.has('NewPayeeCooldown') || (blocked && (codes.has('PayeeNotAllowlisted') || codes.has('BelowReserve')));
  return relevant ? <NextStepsBody codes={codes} blocked={blocked} payeeId={payeeId ?? null} /> : null;
}

function NextStepsBody({ codes, blocked, payeeId }: { codes: Set<string>; blocked: boolean; payeeId: string | null }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const cooling = codes.has('NewPayeeCooldown');
  const cooldown = usePolicy(cooling).data?.newPayeeCooldownHours ?? DEFAULT_COOLDOWN_HOURS;
  const items: ReactNode[] = [];

  if (blocked && codes.has('PayeeNotAllowlisted')) {
    items.push(
      can('payees.manage') ? (
        <StepLink key="allow" to={payeeId ? `/payees?edit=${encodeURIComponent(payeeId)}&allow=1` : '/payees'} icon={ShieldCheck} testId="next-allow-payee">
          {t('nextSteps.allowPayee')}
        </StepLink>
      ) : (
        <p key="allow" className="text-sm">
          {t('nextSteps.allowPayeeAsk')}
        </p>
      ),
    );
  }
  if (blocked && codes.has('BelowReserve')) {
    items.push(
      <StepLink key="reserve" to="/policies#minReserveUsd" icon={SlidersHorizontal} testId="next-lower-reserve">
        {t('nextSteps.lowerReserve')}
      </StepLink>,
      <StepLink key="fund" to="/treasury?fund=1" icon={HandCoins} testId="next-add-funds">
        {t('nextSteps.addFunds')}
      </StepLink>,
    );
  }
  if (items.length === 0 && !cooling) return null;

  return (
    <section aria-label={t('nextSteps.title')} className="space-y-2 rounded-lg border border-info/30 bg-info-soft/60 px-3 py-2.5" data-testid="next-steps">
      <p className="text-xs font-semibold tracking-wide text-info uppercase">{t('nextSteps.title')}</p>
      {cooling ? (
        <p className="flex items-start gap-2 text-sm" data-testid="next-cooldown">
          <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
          {t('nextSteps.cooldown', { hours: cooldown })}
        </p>
      ) : null}
      {items.length > 0 ? <div className="flex flex-wrap gap-2">{items}</div> : null}
    </section>
  );
}
