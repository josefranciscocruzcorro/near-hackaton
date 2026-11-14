import { ArrowLeft, CheckCircle2, FilePlus2, Link2, OctagonX, ShieldAlert, TriangleAlert, UserX } from 'lucide-react';
import { useId, useState, type SubmitEvent } from 'react';
import type { BillFlag, BillInput, Extraction, Payee } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Address, DetailRow } from '../../components/ui/Misc';
import { useI18n } from '../../i18n';
import { chainName } from '../../lib/chains';
import { formatDate, formatNumber } from '../../lib/format';
import { BillFields, formToInput, validateBill, type BillFormErrors, type BillFormState } from './billForm';

function initialState(extraction: Extraction): BillFormState {
  const f = extraction.fields;
  return {
    payeeId: extraction.matchedPayeeId ?? '',
    amount: f.amountUsd === null ? '' : f.amountUsd.toFixed(2),
    dueDate: f.dueDate ?? '',
    category: f.category ?? '',
    reference: f.reference ?? '',
    description: f.description ?? '',
  };
}

const FLAG_ORDER: BillFlag[] = ['SuspiciousInstructions', 'PaymentDetailsMismatch'];

/** Prominent fraud / prompt-injection warnings for an AI extraction. */
export function ExtractionWarnings({ extraction, matchedPayee }: { extraction: Extraction; matchedPayee: Payee | undefined }) {
  const { t } = useI18n();
  const flags = FLAG_ORDER.filter((f) => extraction.flags.includes(f));
  const instr = extraction.fields.paymentInstructions;
  const flagCodes = new Set<string>(extraction.flags);
  const otherWarnings = extraction.warnings.filter((w) => !flagCodes.has(w.code));

  if (flags.length === 0 && otherWarnings.length === 0) {
    return (
      <p data-testid="extraction-clean" className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent-strong">
        <CheckCircle2 aria-hidden className="size-4 shrink-0" />
        {t('import.clean')}
      </p>
    );
  }

  return (
    <div data-testid="extraction-warnings" role="alert" className="space-y-3">
      {flags.map((flag) => (
        <section
          key={flag}
          data-testid={`extraction-flag-${flag}`}
          className="rounded-[10px] border-2 border-danger/50 bg-danger-soft p-4 text-fg"
        >
          <h3 className="flex items-center gap-2 text-md font-semibold text-danger">
            {flag === 'SuspiciousInstructions' ? (
              <ShieldAlert aria-hidden className="size-5 shrink-0" />
            ) : (
              <OctagonX aria-hidden className="size-5 shrink-0" />
            )}
            {t(`flag.${flag}.title`)}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed">{t(`flag.${flag}.body`)}</p>
          {flag === 'PaymentDetailsMismatch' ? (
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-danger/30 bg-surface p-3">
                <dt className="text-xs font-semibold text-danger uppercase">{t('import.invoiceSays')}</dt>
                <dd className="mt-1 text-sm">
                  {instr?.address ? <Address value={instr.address} head={10} tail={6} label={t('import.invoiceAddress')} /> : '—'}
                  <span className="block text-xs text-muted">
                    {[instr?.token, instr?.chain].filter(Boolean).join(' · ') || t('import.unknownNetwork')}
                  </span>
                </dd>
              </div>
              <div className="rounded-lg border border-border bg-surface p-3">
                <dt className="text-xs font-semibold text-muted uppercase">{t('import.onFile')}</dt>
                <dd className="mt-1 text-sm">
                  {matchedPayee ? (
                    <>
                      <Address value={matchedPayee.recipientAddress} head={10} tail={6} label={t('import.onFileAddress')} />
                      <span className="block text-xs text-muted">
                        {matchedPayee.destinationSymbol} · {chainName(matchedPayee.destinationChain)}
                      </span>
                    </>
                  ) : (
                    t('import.noPayeeOnFile')
                  )}
                </dd>
              </div>
            </dl>
          ) : null}
          <p className="mt-3 text-xs font-medium text-danger">{t(`flag.${flag}.consequence`)}</p>
        </section>
      ))}
      {otherWarnings.length > 0 ? (
        <ul className="space-y-1.5 rounded-[10px] border border-warning/40 bg-warning-soft p-3">
          {otherWarnings.map((w, i) => (
            <li key={`${w.code}-${String(i)}`} className="flex items-start gap-2 text-sm text-fg" data-testid="extraction-warning">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>
                <span className="sr-only">{t('severity.warn')}: </span>
                {w.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface ExtractionReviewProps {
  extraction: Extraction;
  payees: Payee[];
  saving: boolean;
  serverErrors?: BillFormErrors;
  onBack: () => void;
  onConfirm: (input: BillInput) => void;
}

/** Step 2 of "Import with AI": what the AI read, risk warnings, editable fields, confirm. */
export function ExtractionReview({ extraction, payees, saving, serverErrors, onBack, onConfirm }: ExtractionReviewProps) {
  const { t, locale } = useI18n();
  const ackId = useId();
  const [form, setForm] = useState<BillFormState>(() => initialState(extraction));
  const [errors, setErrors] = useState<BillFormErrors>({});
  const [ack, setAck] = useState(false);
  const [ackError, setAckError] = useState(false);
  const matchedPayee = payees.find((p) => p.id === extraction.matchedPayeeId);
  const flagged = extraction.flags.length > 0;
  const f = extraction.fields;
  const allErrors = { ...serverErrors, ...errors };

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = validateBill(form, t);
    setErrors(v);
    if (flagged && !ack) setAckError(true);
    if (Object.keys(v).length > 0 || (flagged && !ack)) return;
    onConfirm(formToInput(form, extraction.extractionId));
  };

  return (
    <form id="extraction-review-form" onSubmit={submit} noValidate className="space-y-5" data-testid="extraction-review">
      <ExtractionWarnings extraction={extraction} matchedPayee={matchedPayee} />

      <section aria-labelledby={`${ackId}-read`}>
        <h3 id={`${ackId}-read`} className="mb-1 text-sm font-semibold">
          {t('import.whatAiRead')}
        </h3>
        <dl className="divide-y divide-border rounded-[10px] border border-border px-3">
          <DetailRow label={t('import.payeeName')}>{f.payeeName ?? '—'}</DetailRow>
          <DetailRow label={t('bills.amount')}>
            {f.amountUsd === null ? '—' : <span className="num">{formatNumber(f.amountUsd, locale)} {f.currency ?? 'USD'}</span>}
          </DetailRow>
          <DetailRow label={t('bills.dueDate')}>{f.dueDate ? formatDate(f.dueDate, locale) : '—'}</DetailRow>
          <DetailRow label={t('bills.reference')}>{f.reference ? <span className="num">{f.reference}</span> : '—'}</DetailRow>
          <DetailRow label={t('import.paymentInstructions')}>
            {f.paymentInstructions?.address ? (
              <span className="flex flex-col">
                <Address value={f.paymentInstructions.address} head={10} tail={6} label={t('import.invoiceAddress')} />
                <span className="text-xs text-muted">
                  {[f.paymentInstructions.token, f.paymentInstructions.chain].filter(Boolean).join(' · ')}
                </span>
              </span>
            ) : (
              t('import.noInstructions')
            )}
          </DetailRow>
          <DetailRow label={t('import.matchedPayee')}>
            {matchedPayee ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-accent-strong" data-testid="matched-payee">
                <Link2 aria-hidden className="size-4" />
                {matchedPayee.name}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-warning" data-testid="no-payee-match">
                <UserX aria-hidden className="size-4" />
                {t('import.noMatch')}
              </span>
            )}
          </DetailRow>
        </dl>
      </section>

      <section aria-labelledby={`${ackId}-fields`}>
        <h3 id={`${ackId}-fields`} className="mb-3 text-sm font-semibold">
          {t('import.reviewFields')}
        </h3>
        <BillFields value={form} errors={allErrors} payees={payees} onChange={setForm} idPrefix="import" />
      </section>

      {flagged ? (
        <div className="rounded-lg border border-danger/40 p-3">
          <label htmlFor={ackId} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
            <input
              id={ackId}
              type="checkbox"
              checked={ack}
              onChange={(e) => {
                setAck(e.target.checked);
                setAckError(false);
              }}
              aria-invalid={ackError || undefined}
              aria-describedby={ackError ? `${ackId}-err` : undefined}
              data-testid="extraction-ack"
              className="mt-0.5 size-5 shrink-0 accent-[var(--tz-danger)]"
            />
            <span>{t('import.ack')}</span>
          </label>
          {ackError ? (
            <p id={`${ackId}-err`} className="mt-1 text-xs font-medium text-danger">
              {t('import.ackRequired')}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap justify-between gap-2">
        <Button icon={ArrowLeft} onClick={onBack} disabled={saving}>
          {t('common.back')}
        </Button>
        <Button
          type="submit"
          variant={flagged ? 'danger' : 'primary'}
          icon={FilePlus2}
          loading={saving}
          data-testid="extraction-confirm"
        >
          {flagged ? t('import.createFlagged') : t('import.create')}
        </Button>
      </div>
    </form>
  );
}
