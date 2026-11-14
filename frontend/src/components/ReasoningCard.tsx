import { Bot, Scale } from 'lucide-react';
import type { ReactNode } from 'react';
import { POLICY_REASON_CODES, type PolicyOutcome, type PolicyReason, type PolicyReasonCode } from '../api/types';
import { useI18n } from '../i18n';
import { cn } from '../lib/cn';
import { SEVERITY_VISUAL, TONE_TEXT } from '../lib/status';
import { NextSteps } from './NextSteps';
import { OutcomeChip } from './StatusChips';

const SEVERITY_ORDER = { block: 0, warn: 1, info: 2 } as const;

const isKnownCode = (code: string): code is PolicyReasonCode => (POLICY_REASON_CODES as readonly string[]).includes(code);

/** Policy rules evaluated for a payment, most severe first. Icon + text + severity label (never colour only). */
export function PolicyReasonList({ reasons }: { reasons: PolicyReason[] }) {
  const { t } = useI18n();
  if (reasons.length === 0) return <p className="text-sm text-muted">{t('reasoning.noReasons')}</p>;
  const sorted = [...reasons].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return (
    <ul className="space-y-2" aria-label={t('reasoning.rulesLabel')}>
      {sorted.map((r, i) => {
        const v = SEVERITY_VISUAL[r.severity];
        const Icon = v.icon;
        return (
          <li key={`${r.code}-${String(i)}`} data-testid="policy-reason" data-severity={r.severity} className="flex items-start gap-2.5">
            <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', TONE_TEXT[v.tone])} />
            <div className="min-w-0 text-sm">
              <span className="sr-only">{t(`severity.${r.severity}`)}: </span>
              {isKnownCode(r.code) ? (
                <>
                  <span className="font-medium">{t(`reason.${r.code}`)}</span>
                  <span className="text-muted"> — {r.message}</span>
                </>
              ) : (
                // Unknown (newer) server code: show the server's message with its severity only.
                <span>{r.message}</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

interface ReasoningCardProps {
  aiReason: string | null;
  outcome: PolicyOutcome | null;
  reasons: PolicyReason[];
  /** Optional header content (payee, amount…) rendered above the explanation. */
  header?: ReactNode;
  /** Actions (approve/reject) rendered at the bottom. */
  actions?: ReactNode;
  /** Payee of the decision, for "Allow this supplier" when it was blocked for that. */
  payeeId?: string | null;
  className?: string;
  testId?: string;
}

/**
 * Signature component: explains an agent decision as "what the AI proposed and why" + "what the
 * deterministic policy engine decided and which rules it applied".
 */
export function ReasoningCard({ aiReason, outcome, reasons, header, actions, payeeId, className, testId }: ReasoningCardProps) {
  const { t } = useI18n();
  return (
    <article
      data-testid={testId ?? 'reasoning-card'}
      className={cn('overflow-hidden rounded-[10px] border border-border bg-surface', className)}
    >
      {header ? <div className="border-b border-border px-4 py-3 sm:px-5">{header}</div> : null}
      <div className="grid gap-4 px-4 py-4 sm:px-5 md:grid-cols-2 md:gap-6">
        <section aria-label={t('reasoning.aiTitle')}>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            <Bot aria-hidden className="size-4" />
            {t('reasoning.aiTitle')}
          </h3>
          <p className="text-sm leading-relaxed">{aiReason ?? t('reasoning.noAiReason')}</p>
        </section>
        <section aria-label={t('reasoning.policyTitle')}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
              <Scale aria-hidden className="size-4" />
              {t('reasoning.policyTitle')}
            </h3>
            {outcome ? <OutcomeChip outcome={outcome} /> : <span className="text-xs text-muted">{t('reasoning.notEvaluated')}</span>}
          </div>
          <PolicyReasonList reasons={reasons} />
        </section>
      </div>
      <div className="px-4 pb-4 empty:hidden sm:px-5">
        <NextSteps outcome={outcome} reasons={reasons} payeeId={payeeId} />
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2/50 px-4 py-3 sm:px-5">
          {actions}
        </div>
      ) : null}
    </article>
  );
}
