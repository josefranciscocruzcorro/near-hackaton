import { Check, Inbox, X } from 'lucide-react';
import { useId, useState, type SubmitEvent } from 'react';
import { Link } from 'react-router';
import { useDecidePayment, usePendingApprovals, useSettings } from '../api/queries';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { Payment } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { GuardedButton } from '../components/GuardedButton';
import { QueryView } from '../components/QueryView';
import { ReasoningCard } from '../components/ReasoningCard';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Dialog } from '../components/ui/Dialog';
import { TextareaField } from '../components/ui/Field';
import { Address, Money, PageHeader } from '../components/ui/Misc';
import { EmptyState } from '../components/ui/States';
import { useToast } from '../components/ui/Toast';
import { useI18n } from '../i18n';
import { chainName } from '../lib/chains';
import { formatRelative } from '../lib/format';
import { useNow } from '../lib/useNow';

function PaymentHeader({ p }: { p: Payment }) {
  const { t, locale } = useI18n();
  const now = useNow();
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-md font-semibold">{p.payeeName}</h2>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span className="num">{p.billReference}</span>
          <span aria-hidden>·</span>
          <span>{t(`category.${p.category}`)}</span>
          <span aria-hidden>·</span>
          <span>{formatRelative(p.createdAt, now, locale)}</span>
        </p>
      </div>
      <div className="text-right">
        <Money value={p.amountUsd} className="text-lg font-semibold" />
        <p className="flex items-center justify-end gap-1 text-xs text-muted">
          {t('payments.to')} {p.destinationSymbol} · {chainName(p.destinationChain)}
        </p>
        <Address value={p.recipient} label={t('payments.recipient')} className="justify-end" />
      </div>
    </div>
  );
}

function RejectDialog({ payment, onClose, onReject }: { payment: Payment | null; onClose: () => void; onReject: (note: string) => void }) {
  const { t } = useI18n();
  const formId = useId();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (note.trim().length < 3) {
      setError(t('approvals.noteRequired'));
      return;
    }
    onReject(note.trim());
  };

  return (
    <Dialog
      open={payment !== null}
      onClose={onClose}
      size="sm"
      title={t('approvals.rejectTitle')}
      description={payment ? t('approvals.rejectBody', { payee: payment.payeeName, ref: payment.billReference }) : undefined}
      testId="reject-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form={formId} variant="danger" icon={X} data-testid="reject-confirm">
            {t('approvals.reject')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <TextareaField
          label={t('approvals.note')}
          hint={t('approvals.noteHint')}
          required
          rows={3}
          value={note}
          error={error}
          onChange={(e) => {
            setNote(e.target.value);
            setError(null);
          }}
          data-testid="reject-note"
        />
      </form>
    </Dialog>
  );
}

export function ApprovalsPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { can } = useAuth();
  const query = usePendingApprovals();
  const decide = useDecidePayment();
  const [rejecting, setRejecting] = useState<Payment | null>(null);
  const [confirming, setConfirming] = useState<Payment | null>(null);
  const live = useSettings().data?.executionMode === 'Live';

  /** In Live, approving sends real money: show amount, supplier, network/token and address first. */
  const requestApprove = (p: Payment) => {
    if (live || !p.simulation) setConfirming(p);
    else approve(p);
  };

  const approve = (p: Payment) => {
    setConfirming(null);
    decide.mutate(
      { kind: 'approve', id: p.id },
      {
        onSuccess: () =>
          toast({ title: t('approvals.approved'), description: t('approvals.approvedBody', { payee: p.payeeName }), tone: 'success' }),
        onError: (err) => toast({ title: t('approvals.failed'), description: err.message, tone: 'error' }),
      },
    );
  };

  const reject = (note: string) => {
    const p = rejecting;
    if (!p) return;
    setRejecting(null);
    decide.mutate(
      { kind: 'reject', id: p.id, note },
      {
        onSuccess: () => toast({ title: t('approvals.rejected'), description: p.payeeName, tone: 'info' }),
        onError: (err) => toast({ title: t('approvals.failed'), description: err.message, tone: 'error' }),
      },
    );
  };

  return (
    <>
      <PageHeader title={t('approvals.title')} description={t('approvals.subtitle')} />
      {!can('payments.approve') ? (
        <p className="mb-4 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-sm text-info">{t('approvals.readOnly')}</p>
      ) : null}
      <QueryView query={query}>
        {(list) =>
          list.length === 0 ? (
            <Card>
              <EmptyState
                icon={Inbox}
                title={t('approvals.empty')}
                description={t('approvals.emptyBody')}
                action={
                  <Link to="/payments" className="text-sm font-medium text-accent-strong hover:underline">
                    {t('approvals.seeLedger')}
                  </Link>
                }
              />
            </Card>
          ) : (
            <ul className="space-y-4" aria-label={t('approvals.listLabel', { count: list.length })}>
              {list.map((p) => (
                <li key={p.id} data-testid="approval-item">
                  <ReasoningCard
                    aiReason={p.aiReason}
                    outcome={p.policyOutcome}
                    reasons={p.policyReasons}
                    payeeId={p.payeeId}
                    header={<PaymentHeader p={p} />}
                    actions={
                      <>
                        <Link to={`/payments/${p.id}`} className="mr-auto inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-fg pointer-fine:min-h-9">
                          {t('common.details')}
                        </Link>
                        <GuardedButton permission="payments.approve" variant="danger-soft" icon={X} onClick={() => setRejecting(p)} data-testid="reject-button">
                          {t('approvals.reject')}
                        </GuardedButton>
                        <GuardedButton permission="payments.approve" variant="primary" icon={Check} onClick={() => requestApprove(p)} data-testid="approve-button">
                          {t('approvals.approve')}
                        </GuardedButton>
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) approve(confirming);
        }}
        title={t('approvals.liveConfirmTitle')}
        confirmLabel={t('approvals.liveConfirm')}
        icon={Check}
        testId="approve-live-dialog"
      >
        {confirming ? (
          <>
            <p className="font-medium">{t('approvals.liveConfirmBody')}</p>
            <dl className="divide-y divide-border rounded-lg border border-border" data-testid="approve-live-details">
              <div className="flex flex-wrap justify-between gap-x-3 px-3 py-2">
                <dt className="text-muted">{t('bills.amount')}</dt>
                <dd>
                  <Money value={confirming.amountUsd} className="font-semibold" />
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-3 px-3 py-2">
                <dt className="text-muted">{t('payments.payee')}</dt>
                <dd className="font-medium">{confirming.payeeName}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-x-3 px-3 py-2">
                <dt className="text-muted">{t('approvals.liveNetwork')}</dt>
                <dd className="font-medium">
                  {confirming.destinationSymbol} · {chainName(confirming.destinationChain)}
                </dd>
              </div>
              <div className="px-3 py-2">
                <dt className="text-muted">{t('payments.recipient')}</dt>
                <dd className="num mt-0.5 break-all">{confirming.recipient}</dd>
              </div>
            </dl>
            <p className="text-muted">{t('approvals.liveConfirmNote')}</p>
          </>
        ) : null}
      </ConfirmDialog>
      {rejecting ? <RejectDialog key={rejecting.id} payment={rejecting} onClose={() => setRejecting(null)} onReject={reject} /> : null}
    </>
  );
}
