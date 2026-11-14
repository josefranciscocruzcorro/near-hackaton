import type { AgentRunStatus, BillStatus, PaymentStatus, PolicyOutcome } from '../api/types';
import { useI18n } from '../i18n';
import { BILL_STATUS_VISUAL, OUTCOME_VISUAL, PAYMENT_STATUS_VISUAL, RUN_STATUS_VISUAL } from '../lib/status';
import { Chip } from './ui/Chip';

export function PaymentStatusChip({ status }: { status: PaymentStatus }) {
  const { t } = useI18n();
  const v = PAYMENT_STATUS_VISUAL[status];
  return (
    <Chip tone={v.tone} icon={v.icon} spin={v.spin} testId="payment-status-chip">
      {t(`paymentStatus.${status}`)}
    </Chip>
  );
}

export function BillStatusChip({ status }: { status: BillStatus }) {
  const { t } = useI18n();
  const v = BILL_STATUS_VISUAL[status];
  return (
    <Chip tone={v.tone} icon={v.icon} testId="bill-status-chip">
      {t(`billStatus.${status}`)}
    </Chip>
  );
}

export function RunStatusChip({ status }: { status: AgentRunStatus }) {
  const { t } = useI18n();
  const v = RUN_STATUS_VISUAL[status];
  return (
    <Chip tone={v.tone} icon={v.icon} spin={v.spin} testId="run-status-chip">
      {t(`runStatus.${status}`)}
    </Chip>
  );
}

export function OutcomeChip({ outcome }: { outcome: PolicyOutcome }) {
  const { t } = useI18n();
  const v = OUTCOME_VISUAL[outcome];
  return (
    <Chip tone={v.tone} icon={v.icon} testId="policy-outcome-chip">
      {t(`outcome.${outcome}`)}
    </Chip>
  );
}
