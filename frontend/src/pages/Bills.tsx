import { Ban, ChevronDown, FilePlus2, FileText, Flag, Pencil, Sparkles, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { useBills, useCancelBill, useExtractBill, usePayees, useSaveBill } from '../api/queries';
import { BILL_STATUSES, type Bill, type BillInput, type BillStatus, type Extraction } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { GuardedButton } from '../components/GuardedButton';
import { QueryView } from '../components/QueryView';
import { BillStatusChip } from '../components/StatusChips';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { Dialog } from '../components/ui/Dialog';
import { TextareaField } from '../components/ui/Field';
import { Money, PageHeader, Segmented } from '../components/ui/Misc';
import { EmptyState, ErrorState } from '../components/ui/States';
import { useToast } from '../components/ui/Toast';
import { useI18n } from '../i18n';
import { cn } from '../lib/cn';
import { formatDate } from '../lib/format';
import { dueLabel } from '../lib/labels';
import { BillFields, billToForm, emptyBillForm, formToInput, validateBill, type BillFormErrors, type BillFormState } from './bills/billForm';
import { ExtractionReview } from './bills/ExtractionReview';
import { SAMPLE_MALICIOUS, SAMPLE_NORMAL } from './bills/samples';

type Filter = BillStatus | 'all';

function useSaveBillWithToast(onDone: () => void) {
  const { t } = useI18n();
  const { toast } = useToast();
  const save = useSaveBill();
  const [serverErrors, setServerErrors] = useState<BillFormErrors>({});
  const run = (input: BillInput, id?: string) => {
    setServerErrors({});
    save.mutate(
      { id, input },
      {
        onSuccess: (bill) => {
          toast({
            title: id ? t('bills.updated') : t('bills.created'),
            description: bill.flags.length > 0 ? t('bills.createdFlagged') : `${bill.payeeName} · ${bill.reference}`,
            tone: bill.flags.length > 0 ? 'warning' : 'success',
          });
          onDone();
        },
        onError: (err) => {
          if (err instanceof ApiError) setServerErrors(err.fieldErrors);
          toast({ title: t('bills.saveFailed'), description: err.message, tone: 'error' });
        },
      },
    );
  };
  return { run, saving: save.isPending, serverErrors };
}

// ---------- Manual create / edit ----------

function BillFormDialog({ open, bill, onClose }: { open: boolean; bill: Bill | null; onClose: () => void }) {
  const { t } = useI18n();
  const payees = usePayees();
  const [form, setForm] = useState<BillFormState>(() => (bill ? billToForm(bill) : emptyBillForm()));
  const [errors, setErrors] = useState<BillFormErrors>({});
  const { run, saving, serverErrors } = useSaveBillWithToast(onClose);

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = validateBill(form, t);
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    run(formToInput(form, null), bill?.id);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={bill ? t('bills.edit') : t('bills.new')}
      description={t('bills.formHint')}
      testId="bill-form-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="bill-form" variant="primary" loading={saving} data-testid="bill-form-submit">
            {bill ? t('common.save') : t('bills.create')}
          </Button>
        </>
      }
    >
      <QueryView query={payees}>
        {(list) => (
          <form id="bill-form" onSubmit={submit} noValidate>
            <BillFields value={form} errors={{ ...serverErrors, ...errors }} payees={list} onChange={setForm} idPrefix="bill" />
          </form>
        )}
      </QueryView>
    </Dialog>
  );
}

// ---------- Import with AI ----------

function SampleMenu({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const pick = (text: string) => {
    onPick(text);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <Button size="sm" icon={Wand2} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="sample-menu">
        {t('import.trySample')}
        <ChevronDown aria-hidden className="size-3.5" />
      </Button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded-[10px] border border-border bg-surface p-1.5 shadow-xl">
          <button
            type="button"
            data-testid="sample-normal"
            onClick={() => pick(SAMPLE_NORMAL)}
            className="flex min-h-11 w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-surface-2"
          >
            <span className="text-sm font-medium">{t('import.sampleNormal')}</span>
            <span className="text-xs text-muted">{t('import.sampleNormalHint')}</span>
          </button>
          <button
            type="button"
            data-testid="sample-malicious"
            onClick={() => pick(SAMPLE_MALICIOUS)}
            className="flex min-h-11 w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-danger-soft"
          >
            <span className="text-sm font-medium text-danger">{t('import.sampleMalicious')}</span>
            <span className="text-xs text-muted">{t('import.sampleMaliciousHint')}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const payees = usePayees();
  const extract = useExtractBill();
  const [text, setText] = useState('');
  const [textError, setTextError] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const { run, saving, serverErrors } = useSaveBillWithToast(onClose);

  const submitText = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (text.trim().length < 20) {
      setTextError(t('import.textTooShort'));
      return;
    }
    if (text.length > 20_000) {
      setTextError(t('validation.tooLong', { max: 20000 }));
      return;
    }
    setTextError(null);
    extract.mutate(text, {
      onSuccess: (res) => {
        setExtraction(res);
        if (res.flags.length > 0) toast({ title: t('import.flaggedToast'), tone: 'warning' });
      },
      onError: (err) => toast({ title: t('import.failed'), description: err.message, tone: 'error' }),
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t('bills.importAi')}
      description={extraction ? t('import.reviewHint') : t('import.pasteHint')}
      testId="import-dialog"
    >
      {extraction ? (
        <QueryView query={payees}>
          {(list) => (
            <ExtractionReview
              extraction={extraction}
              payees={list}
              saving={saving}
              serverErrors={serverErrors}
              onBack={() => setExtraction(null)}
              onConfirm={(input) => run(input)}
            />
          )}
        </QueryView>
      ) : (
        <form onSubmit={submitText} noValidate className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">{t('import.privacy')}</p>
            <SampleMenu
              onPick={(s) => {
                setText(s);
                setTextError(null);
              }}
            />
          </div>
          <TextareaField
            label={t('import.textLabel')}
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={textError}
            placeholder={t('import.placeholder')}
            className="num text-sm"
            data-testid="bill-import-textarea"
            spellCheck={false}
          />
          {extract.isError ? <ErrorState error={extract.error} className="py-4" /> : null}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" icon={Sparkles} loading={extract.isPending} data-testid="bill-import-extract">
              {extract.isPending ? t('import.reading') : t('import.extract')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

// ---------- List ----------

function FlagChips({ bill }: { bill: Bill }) {
  const { t } = useI18n();
  if (bill.flags.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {bill.flags.map((f) => (
        <Chip key={f} tone="danger" icon={Flag} testId="bill-flag">
          {t(`flag.${f}.short`)}
        </Chip>
      ))}
    </span>
  );
}

function SourceLabel({ bill }: { bill: Bill }) {
  const { t } = useI18n();
  return bill.source === 'AiExtracted' ? (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <Sparkles aria-hidden className="size-3" />
      {t('bills.sourceAi')}
    </span>
  ) : (
    <span className="text-xs text-muted">{t('bills.sourceManual')}</span>
  );
}

function BillActions({ bill, onEdit, onCancel }: { bill: Bill; onEdit: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  if (bill.status !== 'Open') return null;
  return (
    <div className="flex justify-end gap-1">
      {can('bills.edit') ? (
        <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit} aria-label={t('bills.editNamed', { ref: bill.reference })}>
          <span className="hidden xl:inline">{t('common.edit')}</span>
        </Button>
      ) : null}
      {can('bills.cancel') ? (
        <Button size="sm" variant="ghost" icon={Ban} onClick={onCancel} aria-label={t('bills.cancelNamed', { ref: bill.reference })} className="text-danger">
          <span className="hidden xl:inline">{t('bills.cancelBill')}</span>
        </Button>
      ) : null}
    </div>
  );
}

function BillList({ bills, onEdit, onCancel }: { bills: Bill[]; onEdit: (b: Bill) => void; onCancel: (b: Bill) => void }) {
  const { t, locale } = useI18n();
  return (
    <>
      {/* Desktop / tablet table */}
      <Card className="hidden overflow-x-auto xl:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('bills.title')}</caption>
          <thead className="border-b border-border bg-surface-2/60 text-left text-xs font-medium text-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">{t('bills.payee')}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{t('bills.reference')}</th>
              <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">{t('bills.category')}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{t('bills.dueDate')}</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('bills.amount')}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{t('common.status')}</th>
              <th scope="col" className="px-4 py-2.5"><span className="sr-only">{t('common.actions')}</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {bills.map((b) => {
              const due = dueLabel(t, b.dueDate);
              const open = b.status === 'Open' || b.status === 'Scheduled';
              return (
                <tr key={b.id} className="hover:bg-surface-2/40" data-testid="bill-row">
                  <td className="px-4 py-3">
                    <div className="font-medium">{b.payeeName}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <SourceLabel bill={b} />
                      <FlagChips bill={b} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="num">{b.reference}</span>
                    {b.description ? <div className="max-w-56 truncate text-xs text-muted" title={b.description}>{b.description}</div> : null}
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">{t(`category.${b.category}`)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDate(b.dueDate, locale)}
                    {open ? (
                      <div className={cn('text-xs', due.overdue ? 'font-medium text-danger' : due.soon ? 'text-warning' : 'text-muted')}>{due.text}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Money value={b.amountUsd} className="font-medium" />
                  </td>
                  <td className="px-4 py-3">
                    <BillStatusChip status={b.status} />
                  </td>
                  <td className="px-2 py-3">
                    <BillActions bill={b} onEdit={() => onEdit(b)} onCancel={() => onCancel(b)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Mobile cards */}
      <ul className="grid gap-3 lg:grid-cols-2 xl:hidden">
        {bills.map((b) => {
          const due = dueLabel(t, b.dueDate);
          return (
            <li key={b.id}>
              <Card className="p-4" data-testid="bill-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{b.payeeName}</p>
                    <p className="num truncate text-xs text-muted">{b.reference}</p>
                  </div>
                  <Money value={b.amountUsd} className="font-semibold" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <BillStatusChip status={b.status} />
                  <FlagChips bill={b} />
                  <span className={cn('text-xs', due.overdue && b.status === 'Open' ? 'font-medium text-danger' : 'text-muted')}>
                    {formatDate(b.dueDate, locale)}
                  </span>
                  <SourceLabel bill={b} />
                </div>
                {b.status === 'Open' ? (
                  <div className="mt-2 border-t border-border pt-2">
                    <BillActions bill={b} onEdit={() => onEdit(b)} onCancel={() => onCancel(b)} />
                  </div>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function BillsPage() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Bill | null>(null);
  const [cancelling, setCancelling] = useState<Bill | null>(null);
  const bills = useBills(filter === 'all' ? undefined : filter);
  const cancel = useCancelBill();

  // Dialog state lives in the URL so the command palette and deep links can open them.
  const newOpen = params.get('new') === '1';
  const importOpen = params.get('import') === '1';
  const openParam = (key: 'new' | 'import') => setParams((p) => {
    p.set(key, '1');
    return p;
  });
  const closeParam = (key: 'new' | 'import') => setParams((p) => {
    p.delete(key);
    return p;
  }, { replace: true });

  const filters: { value: Filter; label: string }[] = [
    { value: 'all', label: t('common.all') },
    ...BILL_STATUSES.map((s) => ({ value: s, label: t(`billStatus.${s}`) })),
  ];

  const confirmCancel = () => {
    if (!cancelling) return;
    const bill = cancelling;
    cancel.mutate(bill.id, {
      onSuccess: () => {
        toast({ title: t('bills.cancelled'), description: bill.reference, tone: 'success' });
        setCancelling(null);
      },
      onError: (err) => toast({ title: t('bills.cancelFailed'), description: err.message, tone: 'error' }),
    });
  };

  return (
    <>
      <PageHeader
        title={t('bills.title')}
        description={t('bills.subtitle')}
        actions={
          <>
            <GuardedButton permission="bills.extract" icon={Sparkles} onClick={() => openParam('import')} data-testid="import-bill-button">
              {t('bills.importAi')}
            </GuardedButton>
            <GuardedButton permission="bills.create" variant="primary" icon={FilePlus2} onClick={() => openParam('new')} data-testid="new-bill-button">
              {t('bills.new')}
            </GuardedButton>
          </>
        }
      />
      <Segmented label={t('bills.filterLabel')} value={filter} options={filters} onChange={setFilter} className="mb-4" />
      <QueryView query={bills}>
        {(list) =>
          list.length === 0 ? (
            <Card>
              <EmptyState
                icon={FileText}
                title={filter === 'all' ? t('bills.empty') : t('bills.emptyFiltered')}
                description={filter === 'all' ? t('bills.emptyBody') : undefined}
              />
            </Card>
          ) : (
            <BillList bills={list} onEdit={setEditing} onCancel={setCancelling} />
          )
        }
      </QueryView>

      {newOpen ? <BillFormDialog open bill={null} onClose={() => closeParam('new')} /> : null}
      {editing ? <BillFormDialog key={editing.id} open bill={editing} onClose={() => setEditing(null)} /> : null}
      {importOpen ? <ImportDialog open onClose={() => closeParam('import')} /> : null}

      <Dialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={t('bills.cancelTitle')}
        size="sm"
        footer={
          <>
            <Button onClick={() => setCancelling(null)}>{t('common.keep')}</Button>
            <Button variant="danger" icon={Ban} loading={cancel.isPending} onClick={confirmCancel} data-testid="confirm-cancel-bill">
              {t('bills.cancelBill')}
            </Button>
          </>
        }
      >
        {cancelling ? (
          <p className="text-sm">
            {t('bills.cancelBody', { ref: cancelling.reference, payee: cancelling.payeeName })}{' '}
            <Money value={cancelling.amountUsd} /> · {formatDate(cancelling.dueDate, locale)}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
