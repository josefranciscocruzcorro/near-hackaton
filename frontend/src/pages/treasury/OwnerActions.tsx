import {
  Bot,
  CircleCheck,
  CirclePlay,
  KeyRound,
  Landmark,
  LogOut,
  RefreshCw,
  ShieldAlert,
  Snowflake,
  SlidersHorizontal,
  Terminal,
  TriangleAlert,
  UserRoundCog,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useFreezeTreasury, useRefreshAfterOwnerTx } from '../../api/queries';
import type { TreasuryOverview } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { GuardedButton } from '../../components/GuardedButton';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { TextField } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { useI18n, type TFunction } from '../../i18n';
import { richText } from '../../i18n/rich';
import { formatNumber, fromBaseUnits } from '../../lib/format';
import {
  IMPORT_ACCOUNT_COMMAND,
  INSTALL_CLI_COMMAND,
  plainDecimal,
  setAgentCommand,
  setLimitsCommand,
  toBaseUnits,
  unpauseCommand,
  USDC_DECIMALS,
  withdrawCommand,
} from '../../lib/near';
import { buildOwnerTransaction, isPopupBlocked, isWalletCancel, type OwnerAction, type OwnerActionKind } from '../../lib/ownerTx';
import { useOwnerWallet, type OwnerWallet } from '../../wallet/useOwnerWallet';
import { Callout, CommandBlock } from './bits';

function Action({ id, icon: Icon, title, children }: { id: string; icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="rounded-[10px] border border-border p-4" aria-labelledby={`owner-action-${id}`} data-testid={`owner-action-${id}`}>
      <h3 id={`owner-action-${id}`} className="flex items-center gap-2 font-semibold">
        <Icon aria-hidden className="size-4 shrink-0 text-muted" />
        {title}
      </h3>
      <div className="mt-2 space-y-3 text-sm">{children}</div>
    </section>
  );
}

/** Typed USDC (dot or comma) → base units, or null when it is not a positive amount. */
export const usdcRaw = (v: string): string | null => {
  const raw = toBaseUnits(v.replace(',', '.'), USDC_DECIMALS);
  return raw && raw !== '0' ? raw : null;
};

/** Base units → "10.00" / "10,50" in the UI language, keeping up to 6 decimals when typed. */
export function usdcText(raw: string, locale: string): string {
  const value = fromBaseUnits(raw, USDC_DECIMALS);
  const decimals = Math.max(2, value.split('.')[1]?.length ?? 0);
  return formatNumber(Number(value), locale, decimals);
}

// ---------- Remember what the wallet is signing (MyNearWallet may come back with a redirect) ----------

export const PENDING_WALLET_ACTION_KEY = 'tesorero.wallet.pending';

function rememberPending(kind: OwnerActionKind): void {
  try {
    sessionStorage.setItem(PENDING_WALLET_ACTION_KEY, kind);
  } catch {
    // ignore: the redirect toast is then generic
  }
}

export function takePendingWalletAction(): OwnerActionKind | null {
  try {
    const v = sessionStorage.getItem(PENDING_WALLET_ACTION_KEY);
    sessionStorage.removeItem(PENDING_WALLET_ACTION_KEY);
    return v === 'withdraw' || v === 'unpause' || v === 'setLimits' ? v : null;
  } catch {
    return null;
  }
}

export function walletDoneTitle(t: TFunction, kind: OwnerActionKind | null): string {
  if (kind === 'withdraw') return t('wallet.done.withdraw');
  if (kind === 'unpause') return t('wallet.done.unpause');
  if (kind === 'setLimits') return t('wallet.done.setLimits');
  return t('wallet.done.generic');
}

// ---------- "Sign with my wallet" ----------

function WalletPanel({ wallet, owner }: { wallet: OwnerWallet; owner: string }) {
  const { t } = useI18n();
  const account = wallet.accountId;
  const ownerStrong = <strong className="num break-all">{owner}</strong>;
  return (
    <section aria-labelledby="wallet-panel-title" className="rounded-[10px] border border-accent/40 bg-accent-soft/40 p-4" data-testid="wallet-panel" data-account={account ?? ''}>
      <h3 id="wallet-panel-title" className="flex items-center gap-2 font-semibold">
        <Wallet aria-hidden className="size-4 shrink-0 text-accent-strong" />
        {t('wallet.title')}
      </h3>
      {account === null ? (
        <div className="mt-2 space-y-3 text-sm">
          <p>{richText(t('wallet.intro'), { owner: ownerStrong })}</p>
          <GuardedButton
            permission="treasury.manage"
            variant="primary"
            icon={Wallet}
            loading={wallet.status === 'loading'}
            onClick={() => void wallet.connect().catch(() => undefined)}
            data-testid="wallet-connect"
          >
            {t('wallet.connect')}
          </GuardedButton>
          <p className="text-xs text-muted">{t('wallet.supported')}</p>
        </div>
      ) : account === owner ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <Chip tone="success" icon={CircleCheck} testId="wallet-connected">
            {t('wallet.connectedAs', { account })}
          </Chip>
          <Button size="sm" variant="ghost" icon={LogOut} onClick={() => void wallet.disconnect()} data-testid="wallet-disconnect">
            {t('wallet.disconnect')}
          </Button>
        </div>
      ) : (
        <Callout tone="warning" icon={UserRoundCog} title={t('wallet.wrongTitle')} className="mt-2" testId="wallet-wrong-account">
          <p>{richText(t('wallet.wrongBody'), { account: <strong className="num break-all">{account}</strong>, owner: ownerStrong })}</p>
          <Button size="sm" icon={RefreshCw} className="mt-2" onClick={() => void wallet.switchAccount().catch(() => undefined)} data-testid="wallet-switch">
            {t('wallet.switch')}
          </Button>
        </Callout>
      )}
      {wallet.status === 'error' ? (
        <Callout tone="danger" icon={TriangleAlert} className="mt-3" role="alert" testId="wallet-load-error">
          {t('wallet.loadError')}
        </Callout>
      ) : null}
    </section>
  );
}

// ---------- Emergency freeze (signed by the agent, server-side) ----------

function FreezeAction({ data, onUnpause }: { data: TreasuryOverview; onUnpause: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const freeze = useFreezeTreasury();
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const paused = data.onChain?.paused ?? false;
  const close = () => {
    setOpen(false);
    setUnderstood(false);
  };
  const confirm = () => {
    if (!understood) return;
    freeze.mutate(undefined, {
      onSuccess: () => {
        close();
        toast({ title: t('freeze.done'), description: t('freeze.doneBody'), tone: 'warning', duration: 9000 });
      },
      onError: (err) => toast({ title: t('freeze.failed'), description: err.message, tone: 'error' }),
    });
  };
  return (
    <Action id="freeze" icon={Snowflake} title={t('freeze.title')}>
      {paused ? (
        <Callout tone="danger" icon={Snowflake} title={t('freeze.frozenTitle')} testId="treasury-frozen">
          <p>{t('freeze.frozenBody')}</p>
          <GuardedButton permission="treasury.manage" size="sm" variant="primary" icon={CirclePlay} className="mt-2" onClick={onUnpause} data-testid="frozen-unpause">
            {t('wallet.unpauseButton')}
          </GuardedButton>
        </Callout>
      ) : (
        <>
          <p>{t('freeze.body')}</p>
          <p className="text-muted">{t('freeze.notStop')}</p>
          <GuardedButton
            permission="treasury.manage"
            blockedReason={data.demo ? t('treasury.demo.blocked') : null}
            variant="danger-soft"
            icon={Snowflake}
            onClick={() => setOpen(true)}
            data-testid="freeze-button"
          >
            {t('freeze.button')}
          </GuardedButton>
        </>
      )}
      <ConfirmDialog
        open={open}
        onClose={close}
        onConfirm={confirm}
        title={t('freeze.confirmTitle')}
        confirmLabel={t('freeze.confirm')}
        icon={Snowflake}
        variant="danger"
        loading={freeze.isPending}
        testId="freeze-dialog"
      >
        <p className="font-medium">{t('freeze.confirmBody')}</p>
        <p className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 font-medium text-danger">{t('freeze.confirmOnlyWallet')}</p>
        <p className="text-muted">{t('freeze.confirmPrefer')}</p>
        <label className="flex min-h-11 items-start gap-2 pt-1 pointer-fine:min-h-0">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--tz-danger)]"
            data-testid="freeze-understood"
          />
          <span>{t('freeze.understood')}</span>
        </label>
        {!understood ? <p className="text-xs text-muted">{t('freeze.tickToContinue')}</p> : null}
      </ConfirmDialog>
    </Action>
  );
}

// ---------- The card ----------

/**
 * What only the owner's wallet can do. "Sign with my wallet" (NEAR Wallet Selector) builds the exact
 * transaction; the command line stays available under "Advanced" (ADR-0007 §5). Tesorero never
 * holds the owner's keys: it only asks her wallet to sign.
 */
export function OwnerActionsCard({ data, owner, treasury }: { data: TreasuryOverview; owner: string; treasury: string }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const { toast } = useToast();
  const wallet = useOwnerWallet();
  const refresh = useRefreshAfterOwnerTx();
  const ctx = { owner, treasury };
  const guard = data.onChain;
  const paused = guard?.paused ?? false;
  const balance = data.balances?.treasuryUsdc ?? null;
  const [max, setMax] = useState(plainDecimal(guard?.maxPerPayment ?? data.setup?.maxPerPayment ?? 50));
  const [daily, setDaily] = useState(plainDecimal(guard?.dailyLimit ?? data.setup?.dailyLimit ?? 100));
  const [amount, setAmount] = useState(plainDecimal(balance ?? 0));
  // The red error waits until she edits the amount or tries to withdraw.
  const [amountTouched, setAmountTouched] = useState(false);
  const maxRaw = usdcRaw(max);
  const dailyRaw = usdcRaw(daily);
  const amountRaw = usdcRaw(amount);
  const limitsError =
    !maxRaw || !dailyRaw ? t('treasury.owner.limitsInvalid') : BigInt(maxRaw) > BigInt(dailyRaw) ? t('treasury.setup.maxOverDaily') : null;
  const balanceRaw = balance === null ? null : toBaseUnits(plainDecimal(balance, USDC_DECIMALS), USDC_DECIMALS);
  const amountError = !amountRaw
    ? t('treasury.owner.amountInvalid')
    : balanceRaw !== null && BigInt(amountRaw) > BigInt(balanceRaw)
      ? t('wallet.amountOverBalance', { balance: formatNumber(balance ?? 0, locale, 2) })
      : null;

  // The action waiting for confirmation, and the one waiting for the right wallet to sign in.
  const [confirming, setConfirming] = useState<OwnerAction | null>(null);
  const [afterSignIn, setAfterSignIn] = useState<OwnerAction | null>(null);
  const [sending, setSending] = useState(false);
  const isOwnerWallet = wallet.accountId === owner;
  const toConfirm = confirming ?? (isOwnerWallet ? afterSignIn : null);
  const blocked = data.demo ? t('treasury.demo.blocked') : null;

  const request = (action: OwnerAction) => {
    if (isOwnerWallet) {
      setConfirming(action);
      return;
    }
    setAfterSignIn(action);
    // Not connected (or the wrong account): open the wallet picker first; confirmation follows.
    void (wallet.accountId === null ? wallet.connect() : wallet.switchAccount()).catch(() => undefined);
  };

  const closeConfirm = () => {
    setConfirming(null);
    setAfterSignIn(null);
  };

  const send = async (action: OwnerAction) => {
    setSending(true);
    rememberPending(action.kind);
    try {
      const hash = await wallet.send(buildOwnerTransaction(treasury, owner, action));
      takePendingWalletAction();
      closeConfirm();
      toast({ title: walletDoneTitle(t, action.kind), description: hash ? t('wallet.doneTx', { hash }) : t('wallet.doneBody'), tone: 'success', duration: 9000 });
      refresh();
    } catch (err) {
      takePendingWalletAction();
      if (isWalletCancel(err)) {
        toast({ title: t('wallet.cancelled'), description: t('wallet.cancelledBody'), tone: 'info' });
      } else if (isPopupBlocked(err)) {
        toast({ title: t('wallet.popupBlocked'), description: t('wallet.popupBlockedBody'), tone: 'warning', duration: 0 });
      } else {
        toast({ title: t('wallet.failed'), description: err instanceof Error ? err.message : undefined, tone: 'error', duration: 0 });
      }
    } finally {
      setSending(false);
    }
  };

  const confirmText = (action: OwnerAction): ReactNode => {
    const strong = (v: string) => <strong className="num break-all">{v}</strong>;
    switch (action.kind) {
      case 'withdraw':
        return richText(t('wallet.confirm.withdraw'), { amount: strong(`${usdcText(action.amountRaw, locale)} USDC`), owner: strong(owner) });
      case 'unpause':
        return t('wallet.confirm.unpause');
      case 'setLimits':
        return richText(t('wallet.confirm.setLimits'), {
          max: strong(`${usdcText(action.maxPerPaymentRaw, locale)} USDC`),
          daily: strong(`${usdcText(action.dailyLimitRaw, locale)} USDC`),
        });
    }
  };

  const unpause = () => request({ kind: 'unpause' });

  return (
    <Card role="region" aria-labelledby="owner-actions-title" data-testid="owner-actions">
      <CardHeader
        id="owner-actions-title"
        title={t('treasury.owner.title')}
        description={richText(t('treasury.owner.subtitle'), { owner: <strong className="num break-all">{owner}</strong> })}
        icon={<KeyRound aria-hidden className="mt-0.5 size-5 text-muted" />}
      />
      <div className="space-y-4 p-4 sm:p-5">
        <Callout tone="info" icon={Landmark} title={t('treasury.owner.whyTitle')}>
          {t('treasury.owner.why')}
        </Callout>

        {can('treasury.manage') ? <WalletPanel wallet={wallet} owner={owner} /> : null}

        <Action id="unpause" icon={CirclePlay} title={t('treasury.owner.unpauseTitle')}>
          <p>{paused ? t('treasury.owner.unpauseBody') : t('wallet.notPaused')}</p>
          <GuardedButton
            permission="treasury.manage"
            blockedReason={blocked ?? (paused ? null : t('wallet.notPausedShort'))}
            variant={paused ? 'primary' : 'secondary'}
            icon={CirclePlay}
            onClick={unpause}
            data-testid="wallet-unpause"
          >
            {t('wallet.unpauseButton')}
          </GuardedButton>
        </Action>

        <Action id="limits" icon={SlidersHorizontal} title={t('treasury.owner.limitsTitle')}>
          <p>{t('wallet.limitsBody')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={t('treasury.setup.max')} inputMode="decimal" className="num" value={max} onChange={(e) => setMax(e.target.value)} data-testid="owner-limits-max" />
            <TextField label={t('treasury.setup.daily')} inputMode="decimal" className="num" value={daily} onChange={(e) => setDaily(e.target.value)} data-testid="owner-limits-daily" />
          </div>
          {limitsError ? (
            <p role="alert" className="font-medium text-danger">
              {limitsError}
            </p>
          ) : null}
          <GuardedButton
            permission="treasury.manage"
            blockedReason={blocked ?? limitsError}
            icon={SlidersHorizontal}
            onClick={() => {
              if (maxRaw && dailyRaw && !limitsError) request({ kind: 'setLimits', maxPerPaymentRaw: maxRaw, dailyLimitRaw: dailyRaw });
            }}
            data-testid="wallet-limits"
          >
            {t('wallet.limitsButton')}
          </GuardedButton>
        </Action>

        <Action id="withdraw" icon={Landmark} title={t('treasury.owner.withdrawTitle')}>
          <p>{richText(t('treasury.owner.withdrawBody'), { owner: <strong className="num break-all">{owner}</strong> })}</p>
          <TextField
            label={t('treasury.owner.withdrawAmount')}
            inputMode="decimal"
            className="num"
            value={amount}
            error={amountTouched ? amountError : null}
            onChange={(e) => {
              setAmount(e.target.value);
              setAmountTouched(true);
            }}
            data-testid="owner-withdraw-amount"
          />
          <GuardedButton
            permission="treasury.manage"
            blockedReason={blocked ?? (amountTouched ? amountError : null)}
            icon={Landmark}
            onClick={() => {
              setAmountTouched(true);
              if (amountRaw && !amountError) request({ kind: 'withdraw', amountRaw });
            }}
            data-testid="wallet-withdraw"
          >
            {t('wallet.withdrawButton')}
          </GuardedButton>
          <p className="text-muted">{t('treasury.owner.withdrawNote')}</p>
        </Action>

        <FreezeAction data={data} onUnpause={unpause} />

        <details className="group rounded-[10px] border border-border p-4" data-testid="owner-cli">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold pointer-fine:min-h-0">
            <Terminal aria-hidden className="size-4 shrink-0 text-muted" />
            {t('wallet.advanced')}
          </summary>
          <div className="mt-3 space-y-4 text-sm">
            <p className="text-muted">{t('wallet.advancedIntro')}</p>
            <p>{t('treasury.owner.how1')}</p>
            <CommandBlock command={INSTALL_CLI_COMMAND} what={t('treasury.owner.commandWhat')} testId="owner-command-install" />
            <p>{t('treasury.owner.how2', { owner })}</p>
            <CommandBlock command={IMPORT_ACCOUNT_COMMAND} what={t('treasury.owner.commandWhat')} testId="owner-command-import" />
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 font-medium text-warning">
              <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t('wallet.neverPhrase')}
            </p>
            <p className="text-muted">{t('treasury.owner.how3')}</p>
            <h4 className="font-semibold">{t('treasury.owner.unpauseTitle')}</h4>
            <CommandBlock command={unpauseCommand(ctx)} what={t('treasury.owner.commandWhat')} testId="owner-command-unpause" />
            <h4 className="font-semibold">{t('treasury.owner.limitsTitle')}</h4>
            {maxRaw && dailyRaw && !limitsError ? (
              <CommandBlock command={setLimitsCommand(ctx, maxRaw, dailyRaw)} what={t('treasury.owner.commandWhat')} testId="owner-command-limits" />
            ) : (
              <p className="text-muted">{t('wallet.fixAbove')}</p>
            )}
            <h4 className="font-semibold">{t('treasury.owner.withdrawTitle')}</h4>
            {amountRaw ? (
              <CommandBlock command={withdrawCommand(ctx, owner, amountRaw)} what={t('treasury.owner.commandWhat')} testId="owner-command-withdraw" />
            ) : (
              <p className="text-muted">{t('wallet.fixAbove')}</p>
            )}
            {data.agentAccountId ? (
              <>
                <h4 className="flex items-center gap-2 font-semibold">
                  <Bot aria-hidden className="size-4 text-muted" />
                  {t('treasury.owner.agentTitle')}
                </h4>
                <p>{t('treasury.owner.agentBody')}</p>
                <CommandBlock command={setAgentCommand(ctx, data.agentAccountId)} what={t('treasury.owner.commandWhat')} testId="owner-command-agent" />
              </>
            ) : null}
          </div>
        </details>
      </div>

      <ConfirmDialog
        open={toConfirm !== null}
        onClose={closeConfirm}
        onConfirm={() => {
          if (toConfirm) void send(toConfirm);
        }}
        title={t('wallet.confirmTitle')}
        confirmLabel={t('wallet.confirmButton')}
        icon={Wallet}
        variant={toConfirm?.kind === 'withdraw' ? 'danger' : 'primary'}
        loading={sending}
        testId="wallet-confirm"
      >
        {toConfirm ? <p className="text-base" data-testid="wallet-confirm-text">{confirmText(toConfirm)}</p> : null}
        <p className="text-muted">{t('wallet.confirmHow', { account: owner })}</p>
        <p className="text-xs text-muted">
          {richText(t('wallet.confirmContract'), {
            contract: <span className="num break-all">{treasury}</span>,
          })}
        </p>
      </ConfirmDialog>
    </Card>
  );
}

