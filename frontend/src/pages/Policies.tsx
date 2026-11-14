import { CirclePause, Lock, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type SubmitEvent, type ReactNode } from 'react';
import { useBlocker, useLocation } from 'react-router';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ApiError } from '../api/client';
import { usePolicy, useUpdatePolicy } from '../api/queries';
import { CATEGORIES, type Category, type Policy, type PolicyInput } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { GuardedButton } from '../components/GuardedButton';
import { QueryView } from '../components/QueryView';
import { Card } from '../components/ui/Card';
import { SwitchField, TextField } from '../components/ui/Field';
import { PageHeader } from '../components/ui/Misc';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { useI18n, type TFunction, type TranslationKey } from '../i18n';
import { formatDateTime } from '../lib/format';

type NumberKey = Exclude<keyof PolicyInput, 'agentEnabled' | 'requireAllowlistedPayee' | 'categoryBudgets'>;

interface FormState {
  agentEnabled: boolean;
  requireAllowlistedPayee: boolean;
  numbers: Record<NumberKey, string>;
  budgets: Record<Category, string>;
}

const NUMBER_FIELDS: { key: NumberKey; unit: 'usd' | 'hours' | 'days'; label: TranslationKey; hint: TranslationKey }[] = [
  { key: 'maxPerPaymentUsd', unit: 'usd', label: 'policy.maxPerPayment', hint: 'policy.maxPerPaymentHint' },
  { key: 'approvalThresholdUsd', unit: 'usd', label: 'policy.approvalThreshold', hint: 'policy.approvalThresholdHint' },
  { key: 'dailyLimitUsd', unit: 'usd', label: 'policy.dailyLimit', hint: 'policy.dailyLimitHint' },
  { key: 'monthlyLimitUsd', unit: 'usd', label: 'policy.monthlyLimit', hint: 'policy.monthlyLimitHint' },
  { key: 'minReserveUsd', unit: 'usd', label: 'policy.minReserve', hint: 'policy.minReserveHint' },
  { key: 'newPayeeCooldownHours', unit: 'hours', label: 'policy.cooldown', hint: 'policy.cooldownHint' },
  { key: 'planningHorizonDays', unit: 'days', label: 'policy.horizon', hint: 'policy.horizonHint' },
];

const toForm = (p: Policy): FormState => ({
  agentEnabled: p.agentEnabled,
  requireAllowlistedPayee: p.requireAllowlistedPayee,
  numbers: Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, String(p[f.key])])) as Record<NumberKey, string>,
  budgets: Object.fromEntries(CATEGORIES.map((c) => [c, String(p.categoryBudgets[c])])) as Record<Category, string>,
});

/** Accepts `1250.50`, `1,250.50` and the Spanish `1250,50` (a comma followed by 1–2 digits at the end). */
export function parseNum(raw: string, integer: boolean): number | null {
  const trimmed = raw.trim();
  const s = /^\d+,\d{1,2}$/.test(trimmed) ? trimmed.replace(',', '.') : trimmed.replace(/,/g, '');
  if (!(integer ? /^\d+$/ : /^\d+(\.\d{1,2})?$/).test(s)) return null;
  return Number(s);
}

type Errors = Partial<Record<NumberKey | `budget.${Category}`, string>>;

function validate(f: FormState, t: TFunction): { errors: Errors; input: PolicyInput | null } {
  const errors: Errors = {};
  const nums = {} as Record<NumberKey, number>;
  for (const field of NUMBER_FIELDS) {
    const n = parseNum(f.numbers[field.key], field.unit !== 'usd');
    if (n === null) errors[field.key] = field.unit === 'usd' ? t('validation.amountFormat') : t('validation.integer');
    else nums[field.key] = n;
  }
  if (field('planningHorizonDays') && nums.planningHorizonDays < 1) errors.planningHorizonDays = t('validation.atLeastOne');
  if (field('dailyLimitUsd') && field('monthlyLimitUsd') && nums.dailyLimitUsd > nums.monthlyLimitUsd) {
    errors.dailyLimitUsd = t('validation.dailyOverMonthly');
  }
  if (field('approvalThresholdUsd') && field('maxPerPaymentUsd') && nums.approvalThresholdUsd > nums.maxPerPaymentUsd) {
    errors.approvalThresholdUsd = t('validation.thresholdOverMax');
  }
  const budgets = {} as Record<Category, number>;
  for (const c of CATEGORIES) {
    const n = parseNum(f.budgets[c], false);
    if (n === null) errors[`budget.${c}`] = t('validation.amountFormat');
    else budgets[c] = n;
  }
  if (Object.keys(errors).length > 0) return { errors, input: null };
  return {
    errors,
    input: { ...nums, agentEnabled: f.agentEnabled, requireAllowlistedPayee: f.requireAllowlistedPayee, categoryBudgets: budgets },
  };

  function field(k: NumberKey): boolean {
    return errors[k] === undefined;
  }
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-md font-semibold">{title}</h2>
      <p className="mt-0.5 mb-4 text-sm text-muted">{description}</p>
      {children}
    </Card>
  );
}

function PolicyForm({ policy }: { policy: Policy }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const { toast } = useToast();
  const update = useUpdatePolicy();
  const editable = can('policy.edit');
  const [form, setForm] = useState<FormState>(() => toForm(policy));
  const [errors, setErrors] = useState<Errors>({});
  const [errorTick, setErrorTick] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const location = useLocation();
  const unitLabel = { usd: 'USD', hours: t('policy.unitHours'), days: t('policy.unitDays') } as const;
  const dirty = editable && JSON.stringify(form) !== JSON.stringify(toForm(policy));

  // Leaving with unsaved changes: ask inside the app, and let the browser ask on reload/close.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // After a failed save, bring the first field with an error into view and focus it.
  useEffect(() => {
    if (errorTick === 0) return;
    const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    first?.focus({ preventScroll: true });
  }, [errorTick]);

  // Links such as /policies#minReserveUsd (from the treasury checklist) land on that field.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus({ preventScroll: true });
  }, [location.hash]);

  const fail = (fieldErrors: Errors, description?: string) => {
    setErrors(fieldErrors);
    setErrorTick((n) => n + 1);
    toast({ title: t('policy.saveFailed'), description: description ?? t('policy.fixErrors'), tone: 'error' });
  };

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editable) return;
    const { errors: v, input } = validate(form, t);
    if (!input) {
      fail(v);
      return;
    }
    setErrors({});
    update.mutate(input, {
      onSuccess: (p) => {
        setForm(toForm(p));
        toast({ title: t('policy.saved'), description: t('policy.savedBody', { version: p.version }), tone: 'success' });
      },
      onError: (err) => fail(err instanceof ApiError ? err.fieldErrors : {}, err.message),
    });
  };

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="space-y-4" data-testid="policy-form">
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
        title={t('policy.unsavedTitle')}
        confirmLabel={t('policy.unsavedLeave')}
        cancelLabel={t('policy.unsavedStay')}
        variant="danger"
        testId="policy-unsaved-dialog"
      >
        <p>{t('policy.unsavedBody')}</p>
      </ConfirmDialog>
      {dirty ? (
        <p role="status" className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning" data-testid="policy-dirty">
          {t('policy.unsavedNote')}
        </p>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted" data-testid="policy-version">
        <ShieldCheck aria-hidden className="size-4" />
        {t('policy.versionInfo', { version: policy.version, who: policy.updatedBy.toLowerCase() === 'system' ? t('policy.updatedBySystem') : policy.updatedBy, when: formatDateTime(policy.updatedAt, locale) })}
      </p>
      {!editable ? (
        <p className="flex items-center gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-sm text-info">
          <Lock aria-hidden className="size-4 shrink-0" />
          {t('policy.readOnly')}
        </p>
      ) : null}

      <fieldset disabled={!editable || update.isPending} className="space-y-4">
        <legend className="sr-only">{t('policy.title')}</legend>
        <Section title={t('policy.agentSection')} description={t('policy.agentSectionHint')}>
          <div className="space-y-4">
            <SwitchField
              label={t('policy.agentEnabled')}
              hint={
                <>
                  <span className="block">{t('policy.agentEnabledHint')}</span>
                  <span className="mt-1 flex items-start gap-1 font-medium text-fg/80">
                    <CirclePause aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    {t('policy.agentEnabledNotFreeze')}
                  </span>
                </>
              }
              checked={form.agentEnabled}
              onChange={(e) => setForm({ ...form, agentEnabled: e.target.checked })}
              data-testid="policy-agent-enabled"
            />
            <SwitchField
              label={t('policy.requireAllowlist')}
              hint={t('policy.requireAllowlistHint')}
              checked={form.requireAllowlistedPayee}
              onChange={(e) => setForm({ ...form, requireAllowlistedPayee: e.target.checked })}
            />
          </div>
        </Section>

        <Section title={t('policy.limitsSection')} description={t('policy.limitsSectionHint')}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {NUMBER_FIELDS.map((f) => (
              <TextField
                key={f.key}
                id={f.key}
                label={`${t(f.label)} (${unitLabel[f.unit]})`}
                hint={t(f.hint)}
                inputMode={f.unit === 'usd' ? 'decimal' : 'numeric'}
                className="num"
                value={form.numbers[f.key]}
                error={errors[f.key]}
                onChange={(e) => setForm({ ...form, numbers: { ...form.numbers, [f.key]: e.target.value } })}
              />
            ))}
          </div>
        </Section>

        <Section title={t('policy.budgetsSection')} description={t('policy.budgetsSectionHint')}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {CATEGORIES.map((c) => (
              <TextField
                key={c}
                label={`${t(`category.${c}`)} (USD)`}
                inputMode="decimal"
                className="num"
                value={form.budgets[c]}
                error={errors[`budget.${c}`]}
                onChange={(e) => setForm({ ...form, budgets: { ...form.budgets, [c]: e.target.value } })}
              />
            ))}
          </div>
        </Section>
      </fieldset>

      <div className="flex justify-end">
        <GuardedButton permission="policy.edit" type="submit" variant="primary" icon={Save} loading={update.isPending} data-testid="policy-save">
          {t('policy.save')}
        </GuardedButton>
      </div>
    </form>
  );
}

export function PoliciesPage() {
  const { t } = useI18n();
  const query = usePolicy();
  return (
    <>
      <PageHeader title={t('policy.title')} description={t('policy.subtitle')} />
      <QueryView
        query={query}
        loading={
          <div role="status" aria-label={t('common.loading')} className="space-y-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-64" />
            <Skeleton className="h-48" />
          </div>
        }
      >
        {(p) => <PolicyForm key={p.version} policy={p} />}
      </QueryView>
    </>
  );
}
