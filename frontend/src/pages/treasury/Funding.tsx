import {
  ArrowLeftRight,
  CircleCheck,
  CircleX,
  Clock,
  Coins,
  HandCoins,
  Hourglass,
  Info,
  Loader2,
  RotateCcw,
  TimerOff,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import { ApiError } from '../../api/client';
import { FUNDING_OPEN_STATUSES, useCreateFunding, useFundingOptions, useFundings, useRefreshAfterFunding } from '../../api/queries';
import type { Funding, FundingAsset, FundingStatus, TreasuryOverview } from '../../api/types';
import { GuardedButton } from '../../components/GuardedButton';
import { QrCode } from '../../components/QrCode';
import { QueryView } from '../../components/QueryView';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { EmptyState } from '../../components/ui/States';
import { useI18n, type TFunction } from '../../i18n';
import { richText } from '../../i18n/rich';
import { cn } from '../../lib/cn';
import { formatDateTime, formatNumber, formatRelative, truncateMiddle } from '../../lib/format';
import type { Tone } from '../../lib/status';
import { useNow } from '../../lib/useNow';
import { Callout, CopyBlock, Steps } from './bits';

// ---------- helpers ----------

/** Token standard people see in exchanges (Binance lists "BNB Smart Chain (BEP20)"). */
const STANDARDS: Record<string, string> = { bsc: 'BEP20', eth: 'ERC20', tron: 'TRC20' };

export function chainLabel(chain: string, chainName: string): string {
  const std = STANDARDS[chain.toLowerCase()];
  return std && !chainName.includes(std) ? `${chainName} (${std})` : chainName;
}

export const isRecommended = (a: Pick<FundingAsset, 'symbol' | 'chain'>) => a.symbol === 'USDT' && a.chain.toLowerCase() === 'bsc';

const EVM_CHAINS = new Set(['eth', 'base', 'arb', 'op', 'pol', 'bsc', 'avax', 'gnosis']);

export const FUNDING_STATUS_VISUAL: Record<FundingStatus, { tone: Tone; icon: LucideIcon; spin?: boolean }> = {
  PendingDeposit: { tone: 'warning', icon: Hourglass },
  Processing: { tone: 'info', icon: Loader2, spin: true },
  Success: { tone: 'success', icon: CircleCheck },
  Refunded: { tone: 'neutral', icon: RotateCcw },
  Failed: { tone: 'danger', icon: CircleX },
  Expired: { tone: 'neutral', icon: TimerOff },
};

export function FundingStatusChip({ status, testId }: { status: FundingStatus; testId?: string }) {
  const { t } = useI18n();
  const v = FUNDING_STATUS_VISUAL[status];
  return (
    <Chip tone={v.tone} icon={v.icon} spin={v.spin} testId={testId}>
      {t(`treasury.fundingStatus.${status}`)}
    </Chip>
  );
}

const amountText = (n: number, locale: string) => formatNumber(n, locale, n % 1 === 0 ? 2 : Math.min(6, Math.max(2, String(n).split('.')[1]?.length ?? 2)));

function countdown(deadline: string, now: number, t: TFunction): string | null {
  const ms = Date.parse(deadline) - now;
  if (Number.isNaN(ms) || ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? t('treasury.fund.countdownHours', { h, m: mm, s: ss }) : t('treasury.fund.countdown', { m, s: ss });
}

// ---------- USDC on NEAR ----------

function NearUsdcView({ data }: { data: TreasuryOverview }) {
  const { t } = useI18n();
  const address = data.treasuryAccountId ?? '';
  return (
    <div className="space-y-4" data-testid="fund-near">
      <p className="text-sm">{t('treasury.fund.nearIntro')}</p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <QrCode value={address} label={t('treasury.fund.nearQr')} testId="fund-near-qr" className="self-center sm:self-start" />
        <div className="min-w-0 flex-1 space-y-3">
          <CopyBlock label={t('treasury.fund.nearAddress')} value={address} what={t('treasury.fund.nearAddressWhat')} testId="fund-near-address" large />
          <CopyBlock label={t('treasury.fund.usdcContract')} value={data.usdcContractId} what={t('treasury.fund.usdcContractWhat')} />
        </div>
      </div>
      <section aria-labelledby="fund-near-wallet">
        <h3 id="fund-near-wallet" className="mb-2 font-semibold">
          {t('treasury.setup.fromWallet')}
        </h3>
        <Steps items={[t('treasury.fund.nearWallet1'), t('treasury.fund.nearWallet2'), t('treasury.fund.nearWallet3'), t('treasury.fund.nearWallet4')]} />
      </section>
      <section aria-labelledby="fund-near-exchange">
        <h3 id="fund-near-exchange" className="mb-2 font-semibold">
          {t('treasury.fund.nearExchangeTitle')}
        </h3>
        <p className="text-sm">{richText(t('treasury.fund.nearExchange'), { network: <strong>NEAR Protocol (NEAR)</strong> })}</p>
      </section>
      <Callout tone="danger" icon={TriangleAlert} title={t('treasury.fund.warnTitle')} testId="fund-near-warnings">
        <ul className="list-disc space-y-1 pl-5">
          <li>{t('treasury.fund.nearWarnToken', { contract: truncateMiddle(data.usdcContractId, 8, 5) })}</li>
          <li>{t('treasury.fund.nearWarnNetwork')}</li>
          <li>{t('treasury.fund.warnNotAgent')}</li>
        </ul>
      </Callout>
    </div>
  );
}

// ---------- From another network / an exchange ----------

function CrossChainForm({ assets, onCreated }: { assets: FundingAsset[]; onCreated: (f: Funding) => void }) {
  const { t } = useI18n();
  const create = useCreateFunding();
  const initial = assets.find(isRecommended) ?? assets[0];
  const [assetId, setAssetId] = useState(initial?.assetId ?? '');
  const [amount, setAmount] = useState('');
  const [refund, setRefund] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{ provider: boolean; message: string } | null>(null);
  const asset = assets.find((a) => a.assetId === assetId);

  const groups = useMemo(() => {
    const map = new Map<string, FundingAsset[]>();
    for (const a of assets) map.set(a.symbol, [...(map.get(a.symbol) ?? []), a]);
    return [...map.entries()];
  }, [assets]);

  const clear = (field: string) =>
    setErrors((e) => {
      if (!(field in e)) return e;
      return Object.fromEntries(Object.entries(e).filter(([k]) => k !== field));
    });

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v: Record<string, string> = {};
    const normalized = amount.trim().replace(',', '.');
    const n = /^\d+(\.\d{1,6})?$/.test(normalized) ? Number(normalized) : null;
    if (!asset) v.originAssetId = t('treasury.fund.assetRequired');
    if (n === null) v.amount = t('treasury.fund.amountFormat');
    else if (n <= 0) v.amount = t('validation.amountPositive');
    const r = refund.trim();
    if (!r) v.refundAddress = t('treasury.fund.refundRequired');
    else if (asset && EVM_CHAINS.has(asset.chain.toLowerCase()) && !/^0x[0-9a-fA-F]{40}$/.test(r)) {
      v.refundAddress = t('validation.addressInvalid', { chain: chainLabel(asset.chain, asset.chainName) });
    }
    setErrors(v);
    setFormError(null);
    if (Object.keys(v).length > 0 || !asset || n === null) return;
    create.mutate(
      { originAssetId: asset.assetId, amount: n, refundAddress: r },
      {
        onSuccess: onCreated,
        onError: (err) => {
          // `errors.funding` is the provider's (1Click) refusal: it is about the whole request, not
          // about one field, so it shows above the button with a plain-language lead.
          const { funding, ...fields } = err instanceof ApiError ? err.fieldErrors : {};
          setErrors(fields);
          if (funding !== undefined) setFormError({ provider: true, message: funding });
          else if (Object.keys(fields).length === 0) setFormError({ provider: false, message: err.message });
        },
      },
    );
  };

  if (assets.length === 0) return <EmptyState icon={Coins} title={t('treasury.fund.noOptions')} className="py-6" />;

  const label = asset ? chainLabel(asset.chain, asset.chainName) : '';
  return (
    <form onSubmit={submit} noValidate className="space-y-4" data-testid="fund-cross">
      <p className="text-sm">{t('treasury.fund.crossIntro')}</p>
      <SelectField
        label={t('treasury.fund.asset')}
        hint={asset ? (isRecommended(asset) ? t('treasury.fund.assetRecommendedHint') : t('treasury.fund.assetHint', { symbol: asset.symbol, network: label })) : undefined}
        required
        value={assetId}
        error={errors.originAssetId}
        onChange={(e) => {
          setAssetId(e.target.value);
          clear('originAssetId');
        }}
        data-testid="fund-asset"
      >
        {groups.map(([symbol, list]) => (
          <optgroup key={symbol} label={symbol}>
            {list.map((a) => (
              // Short text: phones show the closed <select> in one line. "Recommended" is in the hint.
              <option key={a.assetId} value={a.assetId}>
                {`${a.symbol} · ${chainLabel(a.chain, a.chainName)}${isRecommended(a) ? ' ★' : ''}`}
              </option>
            ))}
          </optgroup>
        ))}
      </SelectField>
      <Callout tone="info" icon={Info}>
        {t('treasury.fund.minimums')}
      </Callout>
      <TextField
        label={asset ? t('treasury.fund.amountOf', { symbol: asset.symbol }) : t('treasury.fund.amount')}
        hint={t('treasury.fund.amountHint')}
        required
        inputMode="decimal"
        className="num"
        placeholder="100"
        value={amount}
        error={errors.amount}
        onChange={(e) => {
          setAmount(e.target.value);
          clear('amount');
        }}
        data-testid="fund-amount"
      />
      <TextField
        label={asset ? t('treasury.fund.refundOn', { network: label }) : t('treasury.fund.refund')}
        hint={asset ? t('treasury.fund.refundHint', { symbol: asset.symbol, network: label }) : undefined}
        required
        className="num"
        value={refund}
        error={errors.refundAddress}
        onChange={(e) => {
          setRefund(e.target.value);
          clear('refundAddress');
        }}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        data-testid="fund-refund"
      />
      {formError ? (
        <Callout tone="danger" icon={TriangleAlert} role="alert" title={formError.provider ? t('treasury.fund.providerErrorTitle') : t('treasury.fund.errorTitle')} testId="fund-form-error">
          {formError.provider ? <p>{t('treasury.fund.providerErrorLead')}</p> : null}
          <p className="mt-1 break-words text-muted" data-testid="fund-form-error-detail">
            {formError.message}
          </p>
        </Callout>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" icon={ArrowLeftRight} loading={create.isPending} data-testid="fund-submit">
          {t('treasury.fund.submit')}
        </Button>
      </div>
    </form>
  );
}

const STATUS_MESSAGE: Record<FundingStatus, { tone: Tone; icon: LucideIcon }> = {
  PendingDeposit: { tone: 'warning', icon: Hourglass },
  Processing: { tone: 'info', icon: Loader2 },
  Success: { tone: 'success', icon: CircleCheck },
  Refunded: { tone: 'neutral', icon: RotateCcw },
  Failed: { tone: 'danger', icon: CircleX },
  Expired: { tone: 'neutral', icon: TimerOff },
};

function DepositInstructions({ funding }: { funding: Funding }) {
  const { t, locale } = useI18n();
  const now = useNow(1000);
  const network = chainLabel(funding.chain, funding.chainName);
  const amount = amountText(funding.amountIn, locale);
  const open = FUNDING_OPEN_STATUSES.includes(funding.status);
  const left = countdown(funding.deadline, now, t);
  const msg = STATUS_MESSAGE[funding.status];
  const vars = {
    usdc: formatNumber(funding.expectedUsdc, locale, 2),
    refund: truncateMiddle(funding.refundAddress, 8, 6),
  };
  return (
    <div className="space-y-4" data-testid="fund-instructions" data-status={funding.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FundingStatusChip status={funding.status} testId="fund-status" />
        <span className="text-xs text-muted">{t('treasury.fund.updatesAlone')}</span>
      </div>
      <Callout tone={msg.tone} icon={msg.icon} role="status" testId="fund-status-message">
        {t(`treasury.fund.statusMsg.${funding.status}`, vars)}
      </Callout>

      {open ? (
        <>
          <div className="rounded-[10px] border-2 border-warning/60 bg-warning-soft p-4">
            <p className="text-sm font-medium text-warning">{t('treasury.fund.sendExactly')}</p>
            <p className="num mt-1 text-2xl font-semibold tracking-tight" data-testid="fund-amount-exact">
              {amount} {funding.symbol}
            </p>
            <p className="mt-1 text-sm">
              {t('treasury.fund.onNetwork')} <strong data-testid="fund-network">{network}</strong>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm" data-testid="fund-deadline">
              <Clock aria-hidden className="size-4 shrink-0" />
              {left
                ? t('treasury.fund.deadline', { when: formatDateTime(funding.deadline, locale), left })
                : t('treasury.fund.deadlinePassed', { when: formatDateTime(funding.deadline, locale) })}
            </p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <QrCode value={funding.depositAddress} label={t('treasury.fund.depositQr')} testId="fund-deposit-qr" className="self-center sm:self-start" />
            <div className="min-w-0 flex-1 space-y-3">
              <CopyBlock
                label={t('treasury.fund.depositAddress', { network })}
                value={funding.depositAddress}
                what={t('treasury.fund.depositAddressWhat')}
                testId="fund-deposit-address"
                large
              />
              {funding.depositMemo ? (
                <>
                  <CopyBlock label={t('treasury.fund.memo')} value={funding.depositMemo} what={t('treasury.fund.memoWhat')} testId="fund-deposit-memo" large />
                  <Callout tone="danger" icon={TriangleAlert} testId="fund-memo-warning">
                    {t('treasury.fund.memoWarning')}
                  </Callout>
                </>
              ) : null}
              <p className="text-sm">{t('treasury.fund.expected', vars)}</p>
            </div>
          </div>
          <Callout tone="danger" icon={TriangleAlert} title={t('treasury.fund.warnTitle')} testId="fund-warnings">
            <ul className="list-disc space-y-1 pl-5">
              <li>{t('treasury.fund.warnExact', { amount, symbol: funding.symbol })}</li>
              <li>{t('treasury.fund.warnNetwork', { network })}</li>
              <li>{t('treasury.fund.warnDeadline')}</li>
              <li>{t('treasury.fund.warnOnce')}</li>
            </ul>
          </Callout>
          <section aria-labelledby="fund-binance-title" className="rounded-lg border border-border p-3">
            <h3 id="fund-binance-title" className="mb-2 font-semibold">
              {t('treasury.fund.binanceTitle')}
            </h3>
            <Steps
              items={[
                t('treasury.fund.binance1'),
                t('treasury.fund.binance2', { symbol: funding.symbol }),
                t('treasury.fund.binance3'),
                richText(t('treasury.fund.binance4'), { network: <strong>{network}</strong> }),
                t('treasury.fund.binance5', { amount, symbol: funding.symbol }),
                ...(funding.depositMemo ? [t('treasury.fund.binanceMemo')] : []),
                t('treasury.fund.binance6'),
              ]}
            />
          </section>
        </>
      ) : null}
      <p className="text-xs text-muted">
        {t('treasury.fund.refundTo')} <span className="num break-all">{funding.refundAddress}</span>
      </p>
    </div>
  );
}

// ---------- Dialog ----------

type View = 'near' | 'cross';

function FundDialogBody({ data, initialFundingId }: { data: TreasuryOverview; initialFundingId: string | null }) {
  const { t } = useI18n();
  const [view, setView] = useState<View>('cross');
  const [fundingId, setFundingId] = useState<string | null>(initialFundingId);
  const [created, setCreated] = useState<Funding | null>(null);
  const options = useFundingOptions(view === 'cross');
  const fundings = useFundings();
  const tracked = fundings.data?.find((f) => f.id === fundingId) ?? (created?.id === fundingId ? created : null);

  if (fundingId && tracked) {
    return (
      <div className="space-y-4">
        <DepositInstructions funding={tracked} />
        <Button
          size="sm"
          icon={HandCoins}
          onClick={() => {
            setFundingId(null);
            setCreated(null);
          }}
          data-testid="fund-new"
        >
          {t('treasury.fund.another')}
        </Button>
      </div>
    );
  }

  const choices: { id: View; icon: LucideIcon; title: string; body: string }[] = [
    { id: 'cross', icon: ArrowLeftRight, title: t('treasury.fund.optionCross'), body: t('treasury.fund.optionCrossBody') },
    { id: 'near', icon: Coins, title: t('treasury.fund.optionNear'), body: t('treasury.fund.optionNearBody') },
  ];
  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label={t('treasury.fund.how')} className="grid gap-2 sm:grid-cols-2">
        {choices.map((c) => {
          const checked = view === c.id;
          const Icon = c.icon;
          return (
            <label
              key={c.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-[10px] border p-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                checked ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2/50',
              )}
            >
              <input
                type="radio"
                name="fund-view"
                value={c.id}
                checked={checked}
                onChange={() => setView(c.id)}
                className="mt-1 size-4 shrink-0 accent-[var(--tz-accent-strong)]"
                data-testid={`fund-option-${c.id}`}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Icon aria-hidden className="size-4 shrink-0" />
                  {c.title}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{c.body}</span>
              </span>
            </label>
          );
        })}
      </div>
      {view === 'near' ? (
        <NearUsdcView data={data} />
      ) : (
        <QueryView query={options}>
          {(o) => (
            <CrossChainForm
              assets={o.assets}
              onCreated={(f) => {
                setCreated(f);
                setFundingId(f.id);
              }}
            />
          )}
        </QueryView>
      )}
    </div>
  );
}

export function FundDialog({ open, onClose, data, fundingId }: { open: boolean; onClose: () => void; data: TreasuryOverview; fundingId: string | null }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} size="lg" title={t('treasury.fund.title')} description={t('treasury.fund.subtitle')} testId="fund-dialog">
      {open ? <FundDialogBody key={fundingId ?? 'new'} data={data} initialFundingId={fundingId} /> : null}
    </Dialog>
  );
}

// ---------- Card: add funds + recent fundings ----------

/** Refreshes balances and movements once a funding reaches a final state. */
function useWatchFundings(fundings: Funding[] | undefined) {
  const refresh = useRefreshAfterFunding();
  const previous = useRef<Map<string, FundingStatus> | null>(null);
  useEffect(() => {
    if (!fundings) return;
    const before = previous.current;
    previous.current = new Map(fundings.map((f) => [f.id, f.status]));
    if (!before) return;
    const finished = fundings.some((f) => {
      const was = before.get(f.id);
      return was !== undefined && FUNDING_OPEN_STATUSES.includes(was) && !FUNDING_OPEN_STATUSES.includes(f.status);
    });
    if (finished) refresh();
  }, [fundings, refresh]);
}

interface FundingCardProps {
  data: TreasuryOverview;
  fundable: boolean;
  onFund: (fundingId?: string) => void;
}

export function FundingCard({ data, fundable, onFund }: FundingCardProps) {
  const { t, locale } = useI18n();
  const now = useNow();
  const fundings = useFundings();
  useWatchFundings(fundings.data);
  const blocked = data.demo ? t('treasury.demo.blocked') : !fundable ? t('treasury.fund.notReady') : null;
  return (
    <Card role="region" aria-labelledby="treasury-funding-title" data-testid="treasury-funding">
      <CardHeader
        id="treasury-funding-title"
        title={t('treasury.fund.cardTitle')}
        description={t('treasury.fund.cardBody')}
        icon={<HandCoins aria-hidden className="mt-0.5 size-5 text-muted" />}
        action={
          <GuardedButton permission="treasury.manage" blockedReason={blocked} variant="primary" icon={HandCoins} onClick={() => onFund()} data-testid="fund-button">
            {t('treasury.fund.button')}
          </GuardedButton>
        }
      />
      <div className="px-4 pt-3 pb-4 sm:px-5">
        <h3 className="text-sm font-semibold">{t('treasury.fund.recent')}</h3>
        <p className="mb-2 text-xs text-muted" data-testid="fundings-direct-note">
          {t('treasury.fund.recentNote')}
        </p>
        <QueryView query={fundings}>
          {(list) =>
            list.length === 0 ? (
              <p className="text-sm text-muted" data-testid="fundings-empty">
                {t('treasury.fund.noRecent')}
              </p>
            ) : (
              <ul className="divide-y divide-border" data-testid="fundings-list">
                {list.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" data-testid="funding-row" data-status={f.status}>
                    <div className="min-w-0 flex-1">
                      <p className="num text-sm font-medium">
                        {amountText(f.amountIn, locale)} {f.symbol}
                        <span className="font-sans font-normal text-muted"> · {chainLabel(f.chain, f.chainName)}</span>
                      </p>
                      <p className="text-xs text-muted">
                        {t('treasury.fund.rowExpected', { usdc: formatNumber(f.expectedUsdc, locale, 2) })} · {formatRelative(f.createdAt, now, locale)}
                      </p>
                    </div>
                    <FundingStatusChip status={f.status} />
                    {FUNDING_OPEN_STATUSES.includes(f.status) ? (
                      <Button size="sm" onClick={() => onFund(f.id)} data-testid="funding-open">
                        {t('treasury.fund.viewInstructions')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          }
        </QueryView>
      </div>
    </Card>
  );
}
