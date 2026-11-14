import { FlaskConical, Info, PlusCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useRefreshAfterOwnerTx, useTreasury } from '../api/queries';
import type { TreasuryOverview } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { GuardedButton } from '../components/GuardedButton';
import { QueryView } from '../components/QueryView';
import { PaymentsSwitchButton } from '../components/PaymentsSwitch';
import { PageHeader } from '../components/ui/Misc';
import { useToast } from '../components/ui/Toast';
import { useI18n } from '../i18n';
import { AccountsCard } from './treasury/Accounts';
import { Callout } from './treasury/bits';
import { FundDialog, FundingCard } from './treasury/Funding';
import { MovementsAlertBanner, MovementsCard } from './treasury/Movements';
import { OwnerActionsCard, takePendingWalletAction, walletDoneTitle } from './treasury/OwnerActions';
import { parseWalletRedirect, WALLET_REDIRECT_PARAMS } from '../lib/ownerTx';
import { SetupDoneCard, SetupWizard } from './treasury/SetupWizard';
import { StatusCard } from './treasury/Status';

const checkOk = (data: TreasuryOverview, id: TreasuryOverview['checks'][number]['id']) => data.checks.some((c) => c.id === id && c.ok);

/** USDC may only be sent once the contract is verified, registered with USDC and locked (ADR-0007). */
export function isFundable(data: TreasuryOverview): boolean {
  return Boolean(data.treasuryAccountId) && checkOk(data, 'contract') && checkOk(data, 'locked') && checkOk(data, 'usdcRegistered');
}

function TreasuryContent({ data, refetch }: { data: TreasuryOverview; refetch: () => Promise<unknown> }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [fund, setFund] = useState<{ open: boolean; fundingId: string | null }>({ open: false, fundingId: null });
  const [replacing, setReplacing] = useState(false);
  const setup = data.setup;
  const hasAccount = Boolean(data.treasuryAccountId);
  const fundable = isFundable(data);
  const inProgress = setup !== null && setup.status !== 'Ready';
  const showWizard = !hasAccount || inProgress || replacing;
  // A treasury saved by hand in Settings that is not a Tesorero contract: offer to create one here.
  const notTesorero = hasAccount && !inProgress && !checkOk(data, 'contract') && setup?.status !== 'Ready';
  const owner = data.ownerAccountId;

  // Command palette shortcut: /treasury?fund=1 opens the funding dialog (the URL is the state).
  const fundFromUrl = params.get('fund') === '1' && fundable && !data.demo && can('treasury.manage');
  const fundOpen = fund.open || fundFromUrl;
  const closeFund = () => {
    setFund({ open: false, fundingId: null });
    if (params.has('fund')) {
      setParams(
        (p) => {
          p.delete('fund');
          return p;
        },
        { replace: true },
      );
    }
  };

  return (
    <div className="space-y-4">
      {data.demo ? (
        <Callout tone="info" icon={FlaskConical} title={t('treasury.demo.title')} testId="treasury-demo">
          {t('treasury.demo.body')}
        </Callout>
      ) : null}
      <MovementsAlertBanner enabled={hasAccount} />
      <AccountsCard data={data} />
      {notTesorero && !replacing ? (
        <Callout tone="warning" icon={Info} title={t('treasury.replace.title', { account: data.treasuryAccountId ?? '' })} testId="setup-replace">
          <p>{t('treasury.replace.body')}</p>
          <GuardedButton
            permission="treasury.manage"
            blockedReason={data.demo ? t('treasury.demo.blocked') : null}
            size="sm"
            icon={PlusCircle}
            className="mt-2"
            onClick={() => setReplacing(true)}
            data-testid="setup-replace-start"
          >
            {t('treasury.replace.cta')}
          </GuardedButton>
        </Callout>
      ) : null}
      {showWizard ? <SetupWizard data={data} onRefresh={refetch} onCancel={replacing ? () => setReplacing(false) : undefined} /> : null}
      {setup?.status === 'Ready' ? <SetupDoneCard data={data} setup={setup} /> : null}
      {hasAccount ? (
        <>
          <StatusCard data={data} />
          <FundingCard data={data} fundable={fundable} onFund={(fundingId) => setFund({ open: true, fundingId: fundingId ?? null })} />
          <MovementsCard enabled />
          {owner && data.treasuryAccountId ? <OwnerActionsCard data={data} owner={owner} treasury={data.treasuryAccountId} /> : null}
          <FundDialog open={fundOpen} fundingId={fund.fundingId} data={data} onClose={closeFund} />
        </>
      ) : null}
    </div>
  );
}

/**
 * MyNearWallet can come back to this page with the result in the URL (`?transactionHashes=` or
 * `?errorCode=`): say what happened, refresh the treasury and clean the URL.
 */
function useWalletRedirect() {
  const { t } = useI18n();
  const { toast } = useToast();
  const refresh = useRefreshAfterOwnerTx();
  const [params, setParams] = useSearchParams();
  const handled = useRef<string | null>(null);
  const search = params.toString();
  useEffect(() => {
    const result = parseWalletRedirect(search);
    if (!result || handled.current === search) return;
    handled.current = search;
    const kind = takePendingWalletAction();
    if (result.kind === 'success') {
      toast({ title: walletDoneTitle(t, kind), description: t('wallet.doneTx', { hash: result.txHashes.join(', ') }), tone: 'success', duration: 9000 });
      refresh();
    } else if (/reject|cancel/i.test(result.errorCode)) {
      toast({ title: t('wallet.cancelled'), description: t('wallet.cancelledBody'), tone: 'info' });
    } else {
      toast({ title: t('wallet.failed'), description: result.message ?? result.errorCode, tone: 'error', duration: 0 });
    }
    setParams(
      (p) => {
        for (const key of WALLET_REDIRECT_PARAMS) p.delete(key);
        return p;
      },
      { replace: true },
    );
  }, [search, setParams, t, toast, refresh]);
}

export function TreasuryPage() {
  const { t } = useI18n();
  const query = useTreasury();
  useWalletRedirect();
  return (
    <>
      <PageHeader title={t('treasury.title')} description={t('treasury.subtitle')} actions={<PaymentsSwitchButton />} />
      <QueryView query={query}>
        {(data) => <TreasuryContent data={data} refetch={query.refetch} />}
      </QueryView>
    </>
  );
}
