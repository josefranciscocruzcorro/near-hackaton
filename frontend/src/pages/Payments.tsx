import { ArrowRight, CreditCard, Download, ExternalLink, FlaskConical, Send, TriangleAlert } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { endpoints } from '../api/endpoints';
import { usePayment, usePayments, useSubmitDeposit } from '../api/queries';
import { PAYMENT_STATUSES, type Payment, type PaymentStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { GuardedButton } from '../components/GuardedButton';
import { QueryView } from '../components/QueryView';
import { NextSteps } from '../components/NextSteps';
import { PolicyReasonList } from '../components/ReasoningCard';
import { OutcomeChip, PaymentStatusChip } from '../components/StatusChips';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { Dialog } from '../components/ui/Dialog';
import { SelectField, TextField } from '../components/ui/Field';
import { Address, DetailRow, Money, PageHeader } from '../components/ui/Misc';
import { EmptyState } from '../components/ui/States';
import { useToast } from '../components/ui/Toast';
import { useI18n } from '../i18n';
import { chainName } from '../lib/chains';
import { downloadBlob } from '../lib/download';
import { formatDateTime, formatNumber, formatRelative, fromBaseUnits, todayIso } from '../lib/format';
import { useNow } from '../lib/useNow';

type Filter = PaymentStatus | 'all';

/** USDC on NEAR has 6 decimals (1Click amountIn is in base units). */
const USDC_DECIMALS = 6;

function SimulationBadge() {
  const { t } = useI18n();
  return (
    <Chip tone="info" icon={FlaskConical} testId="simulation-badge" title={t('payments.simulatedHint')}>
      {t('payments.simulated')}
    </Chip>
  );
}

export function ExportCsvButton() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await endpoints.exportPaymentsCsv();
      downloadBlob(blob, filename ?? `tesorero-payments-${todayIso()}.csv`);
      toast({ title: t('payments.exported'), tone: 'success' });
    } catch (err) {
      toast({ title: t('payments.exportFailed'), description: err instanceof Error ? err.message : undefined, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <GuardedButton permission="payments.export" icon={Download} loading={busy} onClick={() => void run()} data-testid="export-csv-button">
      {t('payments.export')}
    </GuardedButton>
  );
}

function DepositForm({ payment }: { payment: Payment }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const deposit = useSubmitDeposit();
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (txHash.trim().length < 8) {
      setError(t('payments.txRequired'));
      return;
    }
    setError(null);
    deposit.mutate(
      { id: payment.id, txHash: txHash.trim() },
      {
        onSuccess: () => toast({ title: t('payments.depositSent'), tone: 'success' }),
        onError: (err) => toast({ title: t('payments.depositFailed'), description: err.message, tone: 'error' }),
      },
    );
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-[10px] border border-warning/40 bg-warning-soft/60 p-3">
      <p className="text-sm">{t('payments.depositHint')}</p>
      <TextField
        label={t('payments.depositTx')}
        className="num"
        value={txHash}
        error={error}
        onChange={(e) => setTxHash(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <GuardedButton permission="payments.deposit" type="submit" variant="primary" icon={Send} loading={deposit.isPending}>
        {t('payments.submitDeposit')}
      </GuardedButton>
    </form>
  );
}

function PaymentDetail({ payment }: { payment: Payment }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const q = payment.quote;
  return (
    <div className="space-y-5" data-testid="payment-detail">
      <div className="flex flex-wrap items-center gap-2">
        <PaymentStatusChip status={payment.status} />
        {payment.simulation ? <SimulationBadge /> : null}
      </div>
      <p className="-mt-3 text-sm text-muted" data-testid="payment-status-hint">
        {t(`paymentStatusHint.${payment.status}`)}
      </p>

      {payment.status === 'Failed' && payment.lastError ? (
        <div role="alert" className="flex items-start gap-2 rounded-[10px] border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm text-danger" data-testid="payment-last-error">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">{t('payments.lastError')}</p>
            <p className="mt-0.5 break-words">{payment.lastError}</p>
          </div>
        </div>
      ) : null}

      <section aria-labelledby="pd-quote" className="rounded-[10px] border border-border bg-surface-2/50 p-4">
        <h3 id="pd-quote" className="text-xs font-semibold tracking-wide text-muted uppercase">
          {t('payments.route')}
        </h3>
        {q ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="num text-lg font-semibold">
              {formatNumber(Number(fromBaseUnits(q.amountIn, USDC_DECIMALS)), locale)} <span className="text-sm text-muted">USDC · NEAR</span>
            </span>
            <ArrowRight aria-label={t('payments.becomes')} className="size-4 text-muted" />
            <span className="num text-lg font-semibold" data-testid="quote-out">
              {q.amountOutFormatted} <span className="text-sm text-muted">{payment.destinationSymbol} · {chainName(payment.destinationChain)}</span>
            </span>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">{t('payments.noQuote')}</p>
        )}
        {q ? (
          <dl className="mt-3 divide-y divide-border">
            {q.amountOutUsd !== null ? (
              <DetailRow label={t('payments.valueUsd')}>
                <Money value={q.amountOutUsd} />
              </DetailRow>
            ) : null}
            <DetailRow label={t('payments.depositAddress')}>
              {q.depositAddress ? <Address value={q.depositAddress} head={10} tail={6} label={t('payments.depositAddress')} /> : '—'}
            </DetailRow>
            <DetailRow label={t('payments.quotedAt')}>{formatDateTime(q.quotedAt, locale)}</DetailRow>
            {q.deadline ? <DetailRow label={t('payments.deadline')}>{formatDateTime(q.deadline, locale)}</DetailRow> : null}
          </dl>
        ) : null}
      </section>

      {payment.status === 'AwaitingDeposit' && can('payments.deposit') ? <DepositForm payment={payment} /> : null}

      <dl className="divide-y divide-border">
        <DetailRow label={t('payments.payee')}>{payment.payeeName}</DetailRow>
        <DetailRow label={t('bills.reference')}>
          <span className="num">{payment.billReference}</span>
        </DetailRow>
        <DetailRow label={t('bills.amount')}>
          <Money value={payment.amountUsd} className="font-medium" />
        </DetailRow>
        <DetailRow label={t('payments.recipient')}>
          <Address value={payment.recipient} head={10} tail={6} label={t('payments.recipient')} />
        </DetailRow>
        {payment.onChainTxHash ? (
          <DetailRow label={t('payments.onChainTx')}>
            <span className="flex flex-wrap items-center gap-x-2">
              <Address value={payment.onChainTxHash} head={10} tail={6} label={t('payments.onChainTx')} />
              {payment.onChainTxUrl ? (
                <a
                  href={payment.onChainTxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-1 font-medium text-accent-strong hover:underline pointer-fine:min-h-0"
                  data-testid="onchain-tx-link"
                >
                  NearBlocks
                  <ExternalLink aria-hidden className="size-3.5" />
                  <span className="sr-only">{t('common.newTab')}</span>
                </a>
              ) : null}
            </span>
          </DetailRow>
        ) : null}
        <DetailRow label={t('payments.txHash')}>
          {payment.depositTxHash ? <Address value={payment.depositTxHash} head={10} tail={6} label={t('payments.txHash')} /> : '—'}
        </DetailRow>
        <DetailRow label={t('payments.explorer')}>
          {payment.explorerUrl ? (
            <a
              href={payment.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-accent-strong hover:underline"
              data-testid="explorer-link"
            >
              {t('payments.openExplorer')}
              <ExternalLink aria-hidden className="size-3.5" />
              <span className="sr-only">{t('common.newTab')}</span>
            </a>
          ) : (
            '—'
          )}
        </DetailRow>
        <DetailRow label={t('payments.created')}>{formatDateTime(payment.createdAt, locale)}</DetailRow>
        {payment.settledAt ? <DetailRow label={t('payments.settled')}>{formatDateTime(payment.settledAt, locale)}</DetailRow> : null}
      </dl>

      <section aria-labelledby="pd-decision">
        <h3 id="pd-decision" className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
          {t('payments.decision')}
        </h3>
        <div className="space-y-3 rounded-[10px] border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{t('reasoning.policyTitle')}</span>
            <OutcomeChip outcome={payment.policyOutcome} />
          </div>
          <PolicyReasonList reasons={payment.policyReasons} />
          <NextSteps outcome={payment.policyOutcome} reasons={payment.policyReasons} payeeId={payment.payeeId} />
          {payment.aiReason ? (
            <p className="border-t border-border pt-3 text-sm">
              <span className="font-medium">{t('reasoning.aiTitle')}: </span>
              {payment.aiReason}
            </p>
          ) : null}
          {payment.decidedBy ? (
            <p className="border-t border-border pt-3 text-sm" data-testid="decision-info">
              {t('payments.decidedBy', {
                who: payment.decidedBy,
                when: payment.decidedAt ? formatDateTime(payment.decidedAt, locale) : '—',
              })}
              {payment.decisionNote ? <span className="mt-1 block text-muted">“{payment.decisionNote}”</span> : null}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PaymentDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useI18n();
  const query = usePayment(id);
  return (
    <Dialog open onClose={onClose} variant="panel" title={query.data ? query.data.payeeName : t('payments.detail')} description={t('payments.detailHint')} testId="payment-detail-panel">
      <QueryView query={query}>{(p) => <PaymentDetail payment={p} />}</QueryView>
    </Dialog>
  );
}

export function PaymentsPage() {
  const { t, locale } = useI18n();
  const { paymentId } = useParams();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const query = usePayments(filter === 'all' ? undefined : filter);
  const now = useNow();

  return (
    <>
      <PageHeader title={t('payments.title')} description={t('payments.subtitle')} actions={<ExportCsvButton />} />
      <div className="mb-4 max-w-xs">
        <SelectField label={t('payments.filterLabel')} value={filter} onChange={(e) => setFilter(e.target.value as Filter)} data-testid="payment-status-filter">
          <option value="all">{t('common.allStatuses')}</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`paymentStatus.${s}`)}
            </option>
          ))}
        </SelectField>
      </div>
      <QueryView query={query}>
        {(list) =>
          list.length === 0 ? (
            <Card>
              <EmptyState
                icon={CreditCard}
                title={filter === 'all' ? t('payments.empty') : t('payments.emptyFiltered')}
                description={filter === 'all' ? t('payments.emptyBody') : undefined}
              />
            </Card>
          ) : (
            <>
              <Card className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('payments.title')}</caption>
                  <thead className="border-b border-border bg-surface-2/60 text-left text-xs text-muted">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-medium">{t('payments.payee')}</th>
                      <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">{t('payments.destination')}</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('bills.amount')}</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">{t('common.status')}</th>
                      <th scope="col" className="hidden px-4 py-2.5 font-medium xl:table-cell">{t('payments.created')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {list.map((p) => (
                      <tr key={p.id} className="group relative cursor-pointer hover:bg-surface-2/40" data-testid="payment-row">
                        <td className="px-4 py-3">
                          {/* Stretched link: the whole row opens the detail, while keyboard users still tab to one link. */}
                          <Link
                            to={`/payments/${p.id}`}
                            className="font-medium after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-accent"
                          >
                            {p.payeeName}
                          </Link>
                          <div className="num text-xs text-muted">{p.billReference}</div>
                        </td>
                        <td className="hidden px-4 py-3 lg:table-cell">
                          <span className="text-sm">{p.destinationSymbol} · {chainName(p.destinationChain)}</span>
                          <div className="relative z-10 w-fit">
                            <Address value={p.recipient} label={t('payments.recipient')} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Money value={p.amountUsd} className="font-medium" />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <PaymentStatusChip status={p.status} />
                            {p.simulation ? <SimulationBadge /> : null}
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 text-xs text-muted xl:table-cell">{formatRelative(p.createdAt, now, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <ul className="space-y-3 md:hidden">
                {list.map((p) => (
                  <li key={p.id}>
                    <Link to={`/payments/${p.id}`} className="block rounded-[10px] border border-border bg-surface p-4 hover:bg-surface-2/40" data-testid="payment-card">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.payeeName}</p>
                          <p className="truncate text-xs text-muted">
                            {p.destinationSymbol} · {chainName(p.destinationChain)} · {formatRelative(p.createdAt, now, locale)}
                          </p>
                        </div>
                        <Money value={p.amountUsd} className="font-semibold" />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <PaymentStatusChip status={p.status} />
                        {p.simulation ? <SimulationBadge /> : null}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )
        }
      </QueryView>
      {paymentId ? <PaymentDetailDialog key={paymentId} id={paymentId} onClose={() => void navigate('/payments')} /> : null}
    </>
  );
}
