import {
  ArrowRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Hourglass,
  Info,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  Rocket,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { ApiError } from '../../api/client';
import { useCancelTreasurySetup, useCreateTreasurySetup, useDeployTreasury } from '../../api/queries';
import { TREASURY_SETUP_STEP_IDS, type TreasuryOverview, type TreasurySetup } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { GuardedButton } from '../../components/GuardedButton';
import { QrCode } from '../../components/QrCode';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { TextField } from '../../components/ui/Field';
import { DetailRow, Meter, Money } from '../../components/ui/Misc';
import { useToast } from '../../components/ui/Toast';
import { useI18n, type TFunction } from '../../i18n';
import { richText } from '../../i18n/rich';
import { cn } from '../../lib/cn';
import { formatDateTime, formatNumber } from '../../lib/format';
import { isValidNearAccount, nearblocksAccountUrl, nearblocksTxUrl, parseAmount, plainDecimal } from '../../lib/near';
import { Callout, CopyBlock, ExtLink, Steps } from './bits';

/** Sensible small first limits: they cap what could ever be lost, even with a compromised server. */
export const DEFAULT_MAX_PER_PAYMENT = 50;
export const DEFAULT_DAILY_LIMIT = 100;
export const MAX_LIMIT = 1_000_000;

type WizardStep = 1 | 2 | 3 | 4;

const fundsReached = (s: TreasurySetup) => (s.receivedNear ?? 0) >= s.minimumNear;

export function wizardStep(setup: TreasurySetup | null): WizardStep {
  if (!setup) return 1;
  if (setup.status === 'Ready') return 4;
  if (setup.status === 'AwaitingFunds') return fundsReached(setup) ? 3 : 2;
  return 3;
}

// ---------- Stepper ----------

function Stepper({ step }: { step: WizardStep }) {
  const { t } = useI18n();
  const labels = [t('treasury.setup.step1'), t('treasury.setup.step2'), t('treasury.setup.step3'), t('treasury.setup.step4')];
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t('treasury.setup.progressLabel')} data-testid="setup-stepper">
      {labels.map((label, i) => {
        const n = (i + 1) as WizardStep;
        const done = n < step;
        const current = n === step;
        return (
          <li
            key={label}
            aria-current={current ? 'step' : undefined}
            data-state={done ? 'done' : current ? 'current' : 'todo'}
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-sm',
              current ? 'border-accent bg-accent-soft font-semibold text-accent-strong' : done ? 'border-border text-fg' : 'border-border text-muted',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'num flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                done ? 'bg-accent-strong text-on-accent' : current ? 'bg-accent-strong text-on-accent' : 'bg-surface-2',
              )}
            >
              {done ? <CircleCheck className="size-4" /> : n}
            </span>
            <span className="min-w-0">
              <span className="sr-only">
                {t('treasury.setup.stepN', { n })}
                {done ? ` (${t('treasury.setup.stepDone')})` : ''}:{' '}
              </span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Step 1: owner wallet + on-chain limits ----------

interface FormState {
  owner: string;
  max: string;
  daily: string;
}

function validate(f: FormState, t: TFunction): Record<string, string> {
  const e: Record<string, string> = {};
  const owner = f.owner.trim();
  if (!owner) e.ownerAccountId = t('treasury.setup.ownerRequired');
  else if (!isValidNearAccount(owner)) e.ownerAccountId = t('validation.nearAccount');
  const max = parseAmount(f.max);
  const daily = parseAmount(f.daily);
  if (max === null) e.maxPerPayment = t('validation.amountFormat');
  else if (max <= 0) e.maxPerPayment = t('validation.amountPositive');
  else if (max > MAX_LIMIT) e.maxPerPayment = t('treasury.setup.limitTooLarge');
  if (daily === null) e.dailyLimit = t('validation.amountFormat');
  else if (daily <= 0) e.dailyLimit = t('validation.amountPositive');
  else if (daily > MAX_LIMIT) e.dailyLimit = t('treasury.setup.limitTooLarge');
  if (max !== null && daily !== null && max > 0 && daily > 0 && max > daily) e.maxPerPayment = t('treasury.setup.maxOverDaily');
  return e;
}

interface SetupFormProps {
  initial: TreasurySetup | null;
  /** NEAR account verified at signup: a sensible first answer for the owner wallet. */
  suggestedOwner?: string | null;
  demo: boolean;
  onDone?: () => void;
  onCancel?: () => void;
}

function SetupForm({ initial, suggestedOwner, demo, onDone, onCancel }: SetupFormProps) {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast } = useToast();
  const create = useCreateTreasurySetup();
  const editable = can('treasury.manage') && !demo;
  const [form, setForm] = useState<FormState>({
    owner: initial?.ownerAccountId ?? suggestedOwner ?? '',
    max: plainDecimal(initial?.maxPerPayment ?? DEFAULT_MAX_PER_PAYMENT),
    daily: plainDecimal(initial?.dailyLimit ?? DEFAULT_DAILY_LIMIT),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const set = (key: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    const field = key === 'owner' ? 'ownerAccountId' : key === 'max' ? 'maxPerPayment' : 'dailyLimit';
    setErrors((e) => {
      if (!(field in e)) return e;
      return Object.fromEntries(Object.entries(e).filter(([k]) => k !== field));
    });
  };

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editable) return;
    const v = validate(form, t);
    setErrors(v);
    setFormError(null);
    if (Object.keys(v).length > 0) return;
    create.mutate(
      { ownerAccountId: form.owner.trim(), maxPerPayment: parseAmount(form.max) ?? 0, dailyLimit: parseAmount(form.daily) ?? 0 },
      {
        onSuccess: () => {
          toast({ title: t('treasury.setup.created'), tone: 'success' });
          onDone?.();
        },
        onError: (err) => {
          const fields = err instanceof ApiError ? err.fieldErrors : {};
          setErrors(fields);
          if (Object.keys(fields).length === 0) setFormError(err.message);
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4" data-testid="setup-form">
      <div className="space-y-2 text-sm">
        <p>{t('treasury.setup.intro')}</p>
        <Steps items={[t('treasury.setup.introStep1'), t('treasury.setup.introStep2'), t('treasury.setup.introStep3')]} />
        <p className="text-muted">{t('treasury.setup.introNoCli')}</p>
      </div>
      <fieldset disabled={!editable || create.isPending} className="space-y-4">
        <legend className="text-md font-semibold">{t('treasury.setup.walletTitle')}</legend>
        <TextField
          label={t('treasury.setup.owner')}
          hint={t('treasury.setup.ownerHint')}
          required
          className="num"
          placeholder="yourname.near"
          value={form.owner}
          error={errors.ownerAccountId}
          onChange={(e) => set('owner', e.target.value.toLowerCase())}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          data-testid="setup-owner"
        />
        {suggestedOwner && !initial && form.owner === suggestedOwner ? (
          <p className="-mt-2 text-xs text-muted" data-testid="setup-owner-suggested">
            {t('treasury.setup.ownerSuggested')}
          </p>
        ) : null}
        <Callout tone="warning" icon={TriangleAlert}>
          {t('treasury.setup.ownerNotExchange')}
        </Callout>
        <div>
          <p className="text-md font-semibold">{t('treasury.setup.limitsTitle')}</p>
          <p className="mt-0.5 text-sm text-muted">{t('treasury.setup.limitsBody')}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('treasury.setup.max')}
            hint={t('treasury.setup.maxHint')}
            required
            inputMode="decimal"
            className="num"
            value={form.max}
            error={errors.maxPerPayment}
            onChange={(e) => set('max', e.target.value)}
            data-testid="setup-max"
          />
          <TextField
            label={t('treasury.setup.daily')}
            hint={t('treasury.setup.dailyHint')}
            required
            inputMode="decimal"
            className="num"
            value={form.daily}
            error={errors.dailyLimit}
            onChange={(e) => set('daily', e.target.value)}
            data-testid="setup-daily"
          />
        </div>
        <p className="flex items-start gap-2 text-sm text-muted">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-strong" />
          {t('treasury.setup.limitsSafety')}
        </p>
      </fieldset>
      {formError ? (
        <p role="alert" className="text-sm font-medium text-danger" data-testid="setup-form-error">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? <Button onClick={onCancel}>{t('common.cancel')}</Button> : null}
        <GuardedButton
          permission="treasury.manage"
          blockedReason={demo ? t('treasury.demo.blocked') : null}
          type="submit"
          variant="primary"
          icon={ArrowRight}
          loading={create.isPending}
          data-testid="setup-submit"
        >
          {initial ? t('treasury.setup.saveChanges') : t('treasury.setup.submit')}
        </GuardedButton>
      </div>
    </form>
  );
}

// ---------- Step 2: send NEAR to the new account ----------

function FundSetupPanel({ setup, demo, onEdit, onRefresh }: { setup: TreasurySetup; demo: boolean; onEdit: () => void; onRefresh: () => Promise<unknown> }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const cancel = useCancelTreasurySetup();
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState(false);
  const checkNow = () => {
    setChecking(true);
    void onRefresh().finally(() => setChecking(false));
  };
  const received = setup.receivedNear ?? 0;
  const near = (n: number) => formatNumber(n, locale, 2);
  const missing = Math.max(setup.minimumNear - received, 0);
  const canStartOver = received <= 0;

  const startOver = () =>
    cancel.mutate(undefined, {
      onSuccess: () => {
        setConfirming(false);
        toast({ title: t('treasury.setup.cancelled'), tone: 'success' });
      },
      onError: (err) => toast({ title: t('treasury.setup.cancelFailed'), description: err.message, tone: 'error' }),
    });

  return (
    <div className="space-y-5" data-testid="setup-fund">
      <div>
        <h3 className="text-md font-semibold">{t('treasury.setup.sendTitle', { amount: near(setup.requiredNear) })}</h3>
        <p className="mt-1 text-sm">{t('treasury.setup.sendWhy')}</p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <QrCode value={setup.accountId} label={t('treasury.setup.qrLabel')} testId="setup-fund-qr" className="self-center sm:self-start" />
        <div className="min-w-0 flex-1 space-y-3">
          <CopyBlock label={t('treasury.setup.address')} value={setup.accountId} what={t('treasury.setup.addressWhat')} testId="setup-fund-address" large />
          <p className="text-xs text-muted">{t('treasury.setup.addressCheck', { start: setup.accountId.slice(0, 6), end: setup.accountId.slice(-6) })}</p>
          <div
            className="rounded-lg border border-border p-3"
            data-testid="setup-received"
            data-received={received}
          >
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{t('treasury.setup.received')}</span>
              <span className="num text-xs text-muted">
                {t('treasury.setup.receivedOf', { received: near(received), required: near(setup.requiredNear) })}
              </span>
            </div>
            <Meter
              value={received}
              max={setup.requiredNear}
              label={t('treasury.setup.received')}
              valueText={t('treasury.setup.receivedOf', { received: near(received), required: near(setup.requiredNear) })}
            />
            <p className="mt-2 flex items-start gap-2 text-sm" role="status" aria-live="polite">
              <Hourglass aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
              {received > 0
                ? t('treasury.setup.receivedPartial', { received: near(received), missing: near(missing), minimum: near(setup.minimumNear) })
                : t('treasury.setup.waiting', { minimum: near(setup.minimumNear) })}
            </p>
            <Button size="sm" className="mt-2" icon={RefreshCw} loading={checking} onClick={checkNow} data-testid="setup-check">
              {t('treasury.setup.checkNow')}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border p-3" aria-labelledby="send-wallet-title">
          <h4 id="send-wallet-title" className="mb-2 font-semibold">
            {t('treasury.setup.fromWallet')}
          </h4>
          <Steps
            items={[
              t('treasury.setup.wallet1'),
              t('treasury.setup.wallet2'),
              t('treasury.setup.wallet3'),
              t('treasury.setup.wallet4', { amount: near(setup.requiredNear) }),
            ]}
          />
        </section>
        <section className="rounded-lg border border-border p-3" aria-labelledby="send-binance-title">
          <h4 id="send-binance-title" className="mb-2 font-semibold">
            {t('treasury.setup.fromBinance')}
          </h4>
          <Steps
            items={[
              t('treasury.setup.binance1'),
              t('treasury.setup.binance2'),
              t('treasury.setup.binance3'),
              richText(t('treasury.setup.binance4'), { network: <strong>NEAR Protocol (NEAR)</strong> }),
              t('treasury.setup.binance5', { amount: near(setup.requiredNear) }),
            ]}
          />
        </section>
      </div>

      <Callout tone="danger" icon={TriangleAlert} title={t('treasury.setup.warnTitle')} testId="setup-fund-warnings">
        <ul className="list-disc space-y-1 pl-5">
          <li>{t('treasury.setup.warnOnlyNear')}</li>
          <li>{t('treasury.setup.warnNoUsdc')}</li>
          <li>{t('treasury.setup.warnNotAgent')}</li>
        </ul>
      </Callout>

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <GuardedButton permission="treasury.manage" blockedReason={demo ? t('treasury.demo.blocked') : null} icon={Pencil} onClick={onEdit} data-testid="setup-edit">
          {t('treasury.setup.edit')}
        </GuardedButton>
        {canStartOver ? (
          <GuardedButton
            permission="treasury.manage"
            blockedReason={demo ? t('treasury.demo.blocked') : null}
            variant="danger-soft"
            icon={RotateCcw}
            onClick={() => setConfirming(true)}
            data-testid="setup-cancel"
          >
            {t('treasury.setup.startOver')}
          </GuardedButton>
        ) : null}
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        size="sm"
        title={t('treasury.setup.startOverTitle')}
        description={t('treasury.setup.startOverBody')}
        testId="setup-cancel-dialog"
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>{t('common.keep')}</Button>
            <Button variant="danger" icon={RotateCcw} loading={cancel.isPending} onClick={startOver} data-testid="setup-cancel-confirm">
              {t('treasury.setup.startOver')}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t('treasury.setup.startOverDetail')}</p>
      </Dialog>
    </div>
  );
}

// ---------- Step 3: create (deploy, register, gas, lock) ----------

function DeployProgress({ setup, running }: { setup: TreasurySetup; running: boolean }) {
  const { t } = useI18n();
  const byId = new Map(setup.steps.map((s) => [s.id, s]));
  const firstPending = TREASURY_SETUP_STEP_IDS.find((id) => (byId.get(id)?.status ?? 'pending') === 'pending');
  return (
    <ol className="space-y-2" data-testid="setup-progress" aria-label={t('treasury.deploy.progressLabel')}>
      {TREASURY_SETUP_STEP_IDS.map((id) => {
        const step = byId.get(id);
        const status = step?.status ?? 'pending';
        const active = running && status === 'pending' && id === firstPending;
        const Icon = status === 'done' ? CircleCheck : status === 'failed' ? CircleX : active ? Loader2 : CircleDashed;
        const stateText =
          status === 'done' ? t('treasury.deploy.done') : status === 'failed' ? t('treasury.deploy.failed') : active ? t('treasury.deploy.running') : t('treasury.deploy.pending');
        return (
          <li
            key={id}
            data-testid={`setup-step-${id}`}
            data-status={active ? 'running' : status}
            className={cn(
              'flex items-start gap-3 rounded-lg border p-3',
              status === 'failed' ? 'border-danger/40 bg-danger-soft' : status === 'done' ? 'border-accent/30' : 'border-border',
            )}
          >
            <Icon
              aria-hidden
              className={cn(
                'mt-0.5 size-5 shrink-0',
                status === 'done' ? 'text-accent-strong' : status === 'failed' ? 'text-danger' : 'text-muted',
                active && 'animate-spin',
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t(`treasury.deploy.${id}`)}</p>
              <p className="text-xs text-muted">{stateText}</p>
              {step?.txHash ? (
                <ExtLink href={nearblocksTxUrl(step.txHash)} className="text-xs" testId={`setup-step-${id}-tx`}>
                  {t('treasury.deploy.viewTx')}
                </ExtLink>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function DeployPanel({ setup, demo }: { setup: TreasurySetup; demo: boolean }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const deploy = useDeployTreasury();
  const [error, setError] = useState<string | null>(null);
  const running = deploy.isPending || setup.status === 'Deploying';
  const failed = !running && setup.status === 'Failed';
  const near = (n: number) => formatNumber(n, locale, 2);

  const run = () => {
    setError(null);
    deploy.mutate(undefined, {
      onSuccess: (s) => {
        if (s.status === 'Ready') toast({ title: t('treasury.deploy.readyToast'), description: t('treasury.deploy.readyToastBody'), tone: 'success' });
        else if (s.status === 'Failed') toast({ title: t('treasury.deploy.failedToast'), description: s.lastError ?? undefined, tone: 'error' });
      },
      onError: (err) => {
        const fields = err instanceof ApiError ? err.fieldErrors : {};
        setError(fields.funds ?? err.message);
      },
    });
  };

  return (
    <div className="space-y-4" data-testid="setup-deploy-panel">
      {!running && !failed ? (
        <>
          <Callout tone="success" icon={CircleCheck} title={t('treasury.deploy.fundsOk', { received: near(setup.receivedNear ?? 0) })} testId="setup-funds-ok">
            {t('treasury.deploy.intro')}
          </Callout>
          <DeployProgress setup={setup} running={false} />
          <p className="flex items-start gap-2 text-sm text-muted">
            <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('treasury.deploy.lockExplain')}
          </p>
        </>
      ) : (
        <>
          {running ? (
            <Callout tone="info" icon={Loader2} title={t('treasury.deploy.runningTitle')} role="status" testId="setup-running">
              {t('treasury.deploy.runningBody')}
            </Callout>
          ) : null}
          {failed ? (
            <Callout tone="danger" icon={TriangleAlert} title={t('treasury.deploy.failedTitle')} role="alert" testId="setup-failed">
              <p className="num break-words" data-testid="setup-last-error">
                {setup.lastError ?? t('error.generic')}
              </p>
              <p className="mt-1">{t('treasury.deploy.failedBody')}</p>
            </Callout>
          ) : null}
          <DeployProgress setup={setup} running={running} />
        </>
      )}
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger" data-testid="setup-deploy-error">
          {error}
        </p>
      ) : null}
      {running ? null : (
        <div className="flex justify-end">
          <GuardedButton
            permission="treasury.manage"
            blockedReason={demo ? t('treasury.demo.blocked') : null}
            variant="primary"
            icon={failed ? RefreshCw : Rocket}
            onClick={run}
            data-testid="setup-deploy"
          >
            {failed ? t('treasury.deploy.retry') : t('treasury.deploy.create')}
          </GuardedButton>
        </div>
      )}
    </div>
  );
}

// ---------- Wizard ----------

interface SetupWizardProps {
  data: TreasuryOverview;
  onRefresh: () => Promise<unknown>;
  onCancel?: () => void;
}

/** Owner-only stepper that creates and locks the treasury contract from the app (ADR-0007 §1). */
export function SetupWizard({ data, onRefresh, onCancel }: SetupWizardProps) {
  const { t } = useI18n();
  const { can } = useAuth();
  const setup = data.setup;
  const [editing, setEditing] = useState(false);
  const step = editing ? 1 : wizardStep(setup);
  const owner = can('treasury.manage');

  return (
    <Card role="region" aria-labelledby="setup-title" data-testid="treasury-setup" data-step={step}>
      <CardHeader id="setup-title" title={t('treasury.setup.title')} description={t('treasury.setup.subtitle')} />
      <div className="space-y-5 p-4 sm:p-5">
        <Stepper step={step} />
        {!owner ? (
          <Callout tone="info" icon={Info} testId="setup-readonly" title={t('treasury.setup.readOnlyTitle')}>
            {t('treasury.setup.readOnlyBody')}
          </Callout>
        ) : null}
        {step === 1 ? (
          owner ? (
            <SetupForm
              key={setup?.id ?? 'new'}
              initial={setup}
              suggestedOwner={data.suggestedOwnerAccountId}
              demo={data.demo}
              onDone={editing ? () => setEditing(false) : undefined}
              onCancel={editing ? () => setEditing(false) : onCancel}
            />
          ) : (
            <div className="space-y-2 text-sm" data-testid="setup-explainer">
              <p>{t('treasury.setup.intro')}</p>
              <Steps items={[t('treasury.setup.introStep1'), t('treasury.setup.introStep2'), t('treasury.setup.introStep3')]} />
            </div>
          )
        ) : null}
        {step === 2 && setup ? (
          <FundSetupPanel setup={setup} demo={data.demo} onEdit={() => setEditing(true)} onRefresh={onRefresh} />
        ) : null}
        {step === 3 && setup ? <DeployPanel setup={setup} demo={data.demo} /> : null}
      </div>
    </Card>
  );
}

// ---------- Step 4: done + public verification ----------

export function SetupDoneCard({ data, setup }: { data: TreasuryOverview; setup: TreasurySetup }) {
  const { t, locale } = useI18n();
  const locked = data.checks.find((c) => c.id === 'locked');
  const maxPerPayment = data.onChain?.maxPerPayment ?? setup.maxPerPayment;
  const dailyLimit = data.onChain?.dailyLimit ?? setup.dailyLimit;
  const account = data.treasuryAccountId ?? setup.accountId;
  return (
    <Card role="region" aria-labelledby="setup-done-title" data-testid="setup-done">
      <CardHeader
        id="setup-done-title"
        title={t('treasury.done.title')}
        description={t('treasury.done.subtitle')}
        icon={<ShieldCheck aria-hidden className="mt-0.5 size-5 text-accent-strong" />}
      />
      <dl className="divide-y divide-border px-4 pt-2 pb-4 sm:px-5">
        <DetailRow label={t('treasury.accounts.treasury.title')}>
          <span className="num break-all">{account}</span>
          <ExtLink href={nearblocksAccountUrl(account)} className="block text-xs">
            {t('treasury.done.verifyOnNearblocks')}
          </ExtLink>
        </DetailRow>
        <DetailRow label={t('treasury.done.codeHash')}>
          <span className="num break-all text-xs" data-testid="setup-code-hash">
            {setup.codeHash}
          </span>
          <span className="block text-xs text-muted">{t('treasury.done.codeHashHint')}</span>
        </DetailRow>
        <DetailRow label={t('treasury.done.locked')}>
          <span data-testid="setup-locked" data-ok={locked?.ok ?? null}>
            {locked === undefined ? '—' : locked.ok ? t('treasury.done.lockedYes') : t('treasury.done.lockedNo')}
          </span>
        </DetailRow>
        <DetailRow label={t('treasury.accounts.owner.title')}>
          <span className="num break-all">{data.ownerAccountId ?? setup.ownerAccountId}</span>
        </DetailRow>
        <DetailRow label={t('treasury.accounts.agent.title')}>
          <span className="num break-all">{data.onChain?.agentId ?? data.agentAccountId ?? '—'}</span>
        </DetailRow>
        <DetailRow label={t('treasury.done.limits')}>
          <span>
            <Money value={maxPerPayment} /> {t('treasury.done.perPayment')} · <Money value={dailyLimit} /> {t('treasury.done.perDay')}
          </span>
        </DetailRow>
        {setup.completedAt ? <DetailRow label={t('treasury.done.completedAt')}>{formatDateTime(setup.completedAt, locale)}</DetailRow> : null}
      </dl>
    </Card>
  );
}
