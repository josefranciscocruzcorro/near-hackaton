import { CATEGORIES, type Bill, type BillInput, type Category, type Payee } from '../../api/types';
import { SelectField, TextareaField, TextField } from '../../components/ui/Field';
import { useI18n, type TFunction } from '../../i18n';
import { chainName } from '../../lib/chains';
import { parseDateOnly } from '../../lib/format';

export interface BillFormState {
  payeeId: string;
  amount: string;
  dueDate: string;
  category: Category | '';
  reference: string;
  description: string;
}

export type BillFormErrors = Partial<Record<keyof BillFormState, string>>;

export const emptyBillForm = (): BillFormState => ({
  payeeId: '',
  amount: '',
  dueDate: '',
  category: '',
  reference: '',
  description: '',
});

export const billToForm = (b: Bill): BillFormState => ({
  payeeId: b.payeeId,
  amount: b.amountUsd.toFixed(2),
  dueDate: b.dueDate,
  category: b.category,
  reference: b.reference,
  description: b.description,
});

/** Parses a user-entered USD amount ("1,250.50", "1250.5" or the Spanish "1250,50"). Returns null when invalid. */
export function parseAmount(raw: string): number | null {
  const compact = raw.replace(/[\s$]/g, '');
  const cleaned = /^\d+,\d{1,2}$/.test(compact) ? compact.replace(',', '.') : compact.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function validateBill(s: BillFormState, t: TFunction): BillFormErrors {
  const e: BillFormErrors = {};
  if (!s.payeeId) e.payeeId = t('validation.payeeRequired');
  const amount = parseAmount(s.amount);
  if (amount === null) e.amount = t('validation.amountFormat');
  else if (amount <= 0) e.amount = t('validation.amountPositive');
  else if (amount > 10_000_000) e.amount = t('validation.amountTooLarge');
  if (!s.dueDate || !parseDateOnly(s.dueDate)) e.dueDate = t('validation.dateRequired');
  if (!s.category) e.category = t('validation.categoryRequired');
  if (!s.reference.trim()) e.reference = t('validation.referenceRequired');
  else if (s.reference.trim().length > 64) e.reference = t('validation.tooLong', { max: 64 });
  if (s.description.length > 500) e.description = t('validation.tooLong', { max: 500 });
  return e;
}

export function formToInput(s: BillFormState, extractionId?: string | null): BillInput {
  return {
    payeeId: s.payeeId,
    amountUsd: parseAmount(s.amount) ?? 0,
    dueDate: s.dueDate,
    category: s.category || 'Supplier',
    reference: s.reference.trim(),
    description: s.description.trim(),
    extractionId: extractionId ?? null,
  };
}

interface BillFieldsProps {
  value: BillFormState;
  errors: BillFormErrors;
  payees: Payee[];
  onChange: (next: BillFormState) => void;
  idPrefix: string;
}

/** Shared bill fields for the manual form and the AI import review step. */
export function BillFields({ value, errors, payees, onChange, idPrefix }: BillFieldsProps) {
  const { t } = useI18n();
  const set = <K extends keyof BillFormState>(key: K, v: BillFormState[K]) => onChange({ ...value, [key]: v });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        id={`${idPrefix}-payee`}
        label={t('bills.payee')}
        required
        value={value.payeeId}
        error={errors.payeeId}
        containerClassName="sm:col-span-2"
        hint={payees.length === 0 ? t('bills.noPayeesHint') : undefined}
        onChange={(e) => {
          const payee = payees.find((p) => p.id === e.target.value);
          onChange({ ...value, payeeId: e.target.value, category: value.category || (payee?.category ?? '') });
        }}
      >
        <option value="">{t('bills.selectPayee')}</option>
        {payees.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {p.destinationSymbol} · {chainName(p.destinationChain)}{p.isAllowlisted ? '' : ` · ${t('payees.notAllowlisted')}`}
          </option>
        ))}
      </SelectField>
      <TextField
        id={`${idPrefix}-amount`}
        label={t('bills.amountUsd')}
        required
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        className="num"
        value={value.amount}
        error={errors.amount}
        onChange={(e) => set('amount', e.target.value)}
      />
      <TextField
        id={`${idPrefix}-due`}
        label={t('bills.dueDate')}
        required
        type="date"
        value={value.dueDate}
        error={errors.dueDate}
        onChange={(e) => set('dueDate', e.target.value)}
      />
      <SelectField
        id={`${idPrefix}-category`}
        label={t('bills.category')}
        required
        value={value.category}
        error={errors.category}
        onChange={(e) => set('category', e.target.value as Category | '')}
      >
        <option value="">{t('bills.selectCategory')}</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {t(`category.${c}`)}
          </option>
        ))}
      </SelectField>
      <TextField
        id={`${idPrefix}-reference`}
        label={t('bills.reference')}
        required
        autoComplete="off"
        className="num"
        placeholder="INV-2026-0001"
        value={value.reference}
        error={errors.reference}
        onChange={(e) => set('reference', e.target.value)}
      />
      <TextareaField
        id={`${idPrefix}-description`}
        label={t('bills.description')}
        rows={2}
        containerClassName="sm:col-span-2"
        value={value.description}
        error={errors.description}
        onChange={(e) => set('description', e.target.value)}
      />
    </div>
  );
}
