import { ArrowRight, Bot, FlaskConical, Lock, Radio, RotateCcw, Save, Server, TriangleAlert, Vault, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { useState, type SubmitEvent } from 'react';
import { ApiError } from '../api/client';
import { usePolicy, useResetDemo, useSettings, useTreasury, useUpdateSettings, useVersion } from '../api/queries';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { ExecutionMode, Settings, TreasuryBalance } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { GuardedButton } from '../components/GuardedButton';
import { QueryView } from '../components/QueryView';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { Dialog } from '../components/ui/Dialog';
import { TextField } from '../components/ui/Field';
import { Address, PageHeader } from '../components/ui/Misc';
import { useToast } from '../components/ui/Toast';
import { useI18n } from '../i18n';
import { cn } from '../lib/cn';
import { formatNumber, formatRelative, formatUsd } from '../lib/format';
import { isValidNearAccount } from '../lib/near';
import { useNow } from '../lib/useNow';

const MODES: { mode: ExecutionMode; icon: typeof Radio }[] = [
  { mode: 'Simulation', icon: FlaskConical },
  { mode: 'Live', icon: Radio },
];

/** The balances Tesorero last read for the saved treasury account (on save and every 10 minutes). */
function TreasuryBalanceLine({ balance }: { balance: TreasuryBalance }) {
  const { t, locale } = useI18n();
  const now = useNow();
  const amount = (value: number | null, decimals: number) => (value === null ? '—' : formatNumber(value, locale, decimals));
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm" data-testid="treasury-balance">
      <Wallet aria-hidden className="size-4 shrink-0 text-muted" />
      <span className="text-muted">{t('settings.balance')}:</span>
      <span className="num font-medium">{amount(balance.usdc, 2)} USDC</span>
      <span className="text-muted">·</span>
      <span className="num font-medium">{amount(balance.near, 4)} NEAR</span>
      <span className="text-xs text-muted">({t('settings.balanceRead', { when: formatRelative(balance.capturedAt, now, locale) })})</span>
    </p>
  );
}

function SettingsForm({ settings }: { settings: Settings }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const { toast } = useToast();
  const update = useUpdateSettings();
  const editable = can('settings.edit');
  const [name, setName] = useState(settings.organizationName);
  const [account, setAccount] = useState(settings.treasuryAccountId ?? '');
  const [mode, setMode] = useState<ExecutionMode>(settings.executionMode);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmLive, setConfirmLive] = useState(false);
  const treasury = useTreasury();
  const policy = usePolicy();
  // A treasury created (or being created) in Treasury owns this field: changing it here by hand
  // would point Tesorero at another account. Without one, it stays editable (manual setups).
  const accountLocked = (treasury.data?.setup ?? null) !== null;

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editable) return;
    const v: Record<string, string> = {};
    if (!name.trim()) v.organizationName = t('validation.nameRequired');
    if (account.trim() && !isValidNearAccount(account.trim())) v.treasuryAccountId = t('validation.nearAccount');
    if (mode === 'Live' && !account.trim()) v.treasuryAccountId = t('settings.liveNeedsAccount');
    if (mode === 'Live' && settings.demo) v.executionMode = t('settings.liveDemoDisabled');
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    // Real money from now on: say exactly what will happen before saving.
    if (mode === 'Live' && settings.executionMode !== 'Live') {
      setConfirmLive(true);
      return;
    }
    save();
  };

  const save = () => {
    update.mutate(
      { organizationName: name.trim(), treasuryAccountId: account.trim() || null, executionMode: mode },
      {
        onSuccess: (saved) => {
          const b = saved.treasuryBalance;
          const fmt = (value: number | null | undefined, decimals: number) => (value == null ? '—' : formatNumber(value, locale, decimals));
          setConfirmLive(false);
          toast({
            title: t('settings.saved'),
            description: saved.treasuryAccountId && b ? t('settings.savedBalance', { usdc: fmt(b.usdc, 2), near: fmt(b.near, 4) }) : undefined,
            tone: 'success',
          });
        },
        onError: (err) => {
          setConfirmLive(false);
          if (err instanceof ApiError) setErrors(err.fieldErrors);
          toast({ title: t('settings.saveFailed'), description: err.message, tone: 'error' });
        },
      },
    );
  };

  const liveDescription = settings.agentAccountId ? t('settings.modeLiveAgent') : t('settings.modeLiveManual');
  const p = policy.data;
  const guard = treasury.data?.onChain ?? null;
  const usd = (n: number) => formatUsd(n, locale);

  return (
    <form onSubmit={submit} noValidate className="space-y-4" data-testid="settings-form">
      <ConfirmDialog
        open={confirmLive}
        onClose={() => setConfirmLive(false)}
        onConfirm={save}
        title={t('settings.liveConfirmTitle')}
        confirmLabel={t('settings.liveConfirm')}
        icon={Radio}
        variant="danger"
        loading={update.isPending}
        testId="live-confirm-dialog"
      >
        <p className="font-medium">{settings.agentAccountId ? t('settings.liveConfirmAgent') : t('settings.liveConfirmManual')}</p>
        {p ? (
          <ul className="list-disc space-y-1 pl-5" data-testid="live-confirm-limits">
            <li>{t('settings.liveConfirmMax', { amount: usd(p.maxPerPaymentUsd) })}</li>
            <li>{t('settings.liveConfirmDaily', { amount: usd(p.dailyLimitUsd), month: usd(p.monthlyLimitUsd) })}</li>
            {/* At or above the max nothing can reach the threshold: amounts over the max are already blocked. */}
            {p.approvalThresholdUsd < p.maxPerPaymentUsd ? (
              <li data-testid="live-confirm-threshold">{t('settings.liveConfirmThreshold', { amount: usd(p.approvalThresholdUsd) })}</li>
            ) : null}
            {guard ? <li>{t('settings.liveConfirmOnChain', { max: usd(guard.maxPerPayment), daily: usd(guard.dailyLimit) })}</li> : null}
          </ul>
        ) : null}
        <p className="text-muted">{t('settings.liveConfirmStop')}</p>
      </ConfirmDialog>
      {!editable ? (
        <p className="flex items-center gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-sm text-info">
          <Lock aria-hidden className="size-4 shrink-0" />
          {t('settings.readOnly')}
        </p>
      ) : null}
      <fieldset disabled={!editable || update.isPending} className="space-y-4">
        <legend className="sr-only">{t('settings.title')}</legend>
        <Card className="space-y-4 p-4 sm:p-5">
          <h2 className="text-md font-semibold">{t('settings.org')}</h2>
          <TextField label={t('settings.orgName')} required value={name} error={errors.organizationName} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
          <TextField
            label={t('settings.treasury')}
            hint={accountLocked ? t('settings.treasuryLockedHint') : t('settings.treasuryHint', { network: settings.network })}
            className="num"
            placeholder="treasury.near"
            value={account}
            error={errors.treasuryAccountId}
            onChange={(e) => setAccount(e.target.value)}
            readOnly={accountLocked}
            aria-readonly={accountLocked || undefined}
            autoComplete="off"
            spellCheck={false}
            data-testid="settings-treasury-account"
          />
          {settings.treasuryBalance && settings.treasuryAccountId && account.trim() === settings.treasuryAccountId ? (
            <TreasuryBalanceLine balance={settings.treasuryBalance} />
          ) : null}
          <Link
            to="/treasury"
            className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent-strong hover:underline pointer-fine:min-h-0"
            data-testid="settings-treasury-link"
          >
            <Vault aria-hidden className="size-4" />
            {accountLocked ? t('settings.treasuryChange') : t('settings.treasuryManage')}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="text-md font-semibold" id="mode-label">
            {t('settings.mode')}
          </h2>
          <p className="mt-0.5 mb-4 text-sm text-muted">{t('settings.modeHint')}</p>
          <div role="radiogroup" aria-labelledby="mode-label" className="grid gap-3 md:grid-cols-2">
            {MODES.map(({ mode: m, icon: Icon }) => {
              const checked = mode === m;
              // The public demo can never move real money (the API also answers 400).
              const locked = m === 'Live' && settings.demo;
              return (
                <label
                  key={m}
                  className={cn(
                    'flex items-start gap-3 rounded-[10px] border p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                    locked ? 'cursor-not-allowed opacity-75' : 'cursor-pointer',
                    checked
                      ? m === 'Live'
                        ? 'border-warning bg-warning-soft'
                        : 'border-info bg-info-soft'
                      : cn('border-border', !locked && 'hover:bg-surface-2/50'),
                  )}
                >
                  <input
                    type="radio"
                    name="executionMode"
                    value={m}
                    checked={checked}
                    disabled={locked}
                    aria-describedby={locked ? 'mode-live-locked' : undefined}
                    onChange={() => setMode(m)}
                    className="mt-1 size-4 shrink-0 accent-[var(--tz-accent-strong)]"
                    data-testid={`mode-${m.toLowerCase()}`}
                  />
                  <span>
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Icon aria-hidden className="size-4" />
                      {m === 'Live' && !settings.agentAccountId ? t('settings.liveManualLabel') : t(`mode.${m}`)}
                    </span>
                    <span className="mt-1 block text-sm text-muted" data-testid={`mode-${m.toLowerCase()}-description`}>
                      {m === 'Simulation' ? t('settings.modeSimulation') : liveDescription}
                    </span>
                    {locked ? (
                      <span id="mode-live-locked" className="mt-2 flex items-start gap-1.5 text-xs font-medium text-fg" data-testid="mode-live-locked">
                        <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        {t('settings.liveDemoDisabled')}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
          {errors.executionMode ? (
            <div role="alert" className="mt-3 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm" data-testid="settings-mode-error">
              <p className="font-medium text-danger">{errors.executionMode}</p>
              {settings.demo ? null : (
                <Link to="/treasury" className="mt-1 inline-flex min-h-11 items-center gap-1 font-medium text-accent-strong hover:underline pointer-fine:min-h-0" data-testid="settings-mode-error-link">
                  {t('settings.treasuryFix')}
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              )}
            </div>
          ) : null}
          {mode === 'Live' && settings.executionMode !== 'Live' ? (
            <p role="alert" className="mt-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
              {t('settings.liveWarning')}
            </p>
          ) : null}
        </Card>
      </fieldset>
      <div className="flex justify-end">
        <GuardedButton permission="settings.edit" type="submit" variant="primary" icon={Save} loading={update.isPending} data-testid="settings-save">
          {t('common.save')}
        </GuardedButton>
      </div>
    </form>
  );
}

function InstanceCard({ settings }: { settings: Settings }) {
  const { t } = useI18n();
  return (
    <Card className="mt-4 p-4 sm:p-5" data-testid="instance-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-md font-semibold">
          <Server aria-hidden className="size-4 text-muted" />
          {t('settings.instance')}
        </h2>
        {settings.demo ? (
          <Chip tone="info" icon={FlaskConical} testId="instance-type">
            {t('settings.instanceDemo')}
          </Chip>
        ) : (
          <Chip tone="success" icon={Radio} testId="instance-type">
            {t('settings.instanceReal')}
          </Chip>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">{settings.demo ? t('settings.instanceDemoBody') : t('settings.instanceRealBody')}</p>
      <dl className="mt-4 grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-3">
        <dt className="flex items-center gap-1.5 text-sm text-muted">
          <Bot aria-hidden className="size-4" />
          {t('settings.agentAccount')}
        </dt>
        <dd className="min-w-0 text-sm" data-testid="agent-account">
          {settings.agentAccountId ? (
            <>
              <Address value={settings.agentAccountId} head={16} tail={8} label={t('settings.agentAccount')} />
              <span className="block text-xs text-muted">{t('settings.agentConfigured')}</span>
            </>
          ) : (
            <span className="text-muted">{t('settings.agentNone')}</span>
          )}
        </dd>
      </dl>
    </Card>
  );
}

function DangerZone() {
  const { t } = useI18n();
  const { toast } = useToast();
  const reset = useResetDemo();
  const [confirming, setConfirming] = useState(false);
  const confirm = () => {
    reset.mutate(undefined, {
      onSuccess: () => {
        setConfirming(false);
        toast({ title: t('demo.resetDone'), description: t('demo.resetDoneBody'), tone: 'success' });
      },
      onError: (err) => toast({ title: t('demo.resetFailed'), description: err.message, tone: 'error' }),
    });
  };
  return (
    <Card className="mt-4 border-danger/40 p-4 sm:p-5" data-testid="danger-zone">
      <h2 className="flex items-center gap-2 text-md font-semibold text-danger">
        <TriangleAlert aria-hidden className="size-4" />
        {t('settings.dangerZone')}
      </h2>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('demo.reset')}</p>
          <p className="mt-0.5 text-sm text-muted">{t('demo.resetHint')}</p>
        </div>
        <GuardedButton permission="demo.reset" variant="danger-soft" icon={RotateCcw} onClick={() => setConfirming(true)} data-testid="reset-demo-button">
          {t('demo.reset')}
        </GuardedButton>
      </div>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        size="sm"
        title={t('demo.resetConfirmTitle')}
        description={t('demo.resetConfirmBody')}
        testId="reset-demo-dialog"
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" icon={RotateCcw} loading={reset.isPending} onClick={confirm} data-testid="reset-demo-confirm">
              {t('demo.resetConfirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t('demo.resetConfirmDetail')}</p>
      </Dialog>
    </Card>
  );
}

function VersionLine() {
  const { t } = useI18n();
  const { data } = useVersion();
  return (
    <p className="mt-6 text-xs text-muted">
      {t('settings.version', { ui: __APP_VERSION__, api: data ? `${data.version} (${data.commit.slice(0, 7)})` : '—' })}
    </p>
  );
}

export function SettingsPage() {
  const { t } = useI18n();
  const query = useSettings();
  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')} />
      <QueryView query={query}>
        {(s) => (
          <>
            <SettingsForm settings={s} />
            <InstanceCard settings={s} />
            {s.demo ? <DangerZone /> : null}
          </>
        )}
      </QueryView>
      <VersionLine />
    </>
  );
}
