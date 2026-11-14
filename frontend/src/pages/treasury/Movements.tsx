import { ArrowDownLeft, ArrowRight, ArrowUpRight, CloudOff, History, Siren } from 'lucide-react';
import { Link } from 'react-router';
import type { Movement, TreasuryMovements } from '../../api/types';
import { QueryView } from '../../components/QueryView';
import { buttonClasses } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { Address } from '../../components/ui/Misc';
import { EmptyState } from '../../components/ui/States';
import { useTreasuryMovements } from '../../api/queries';
import { useI18n } from '../../i18n';
import { cn } from '../../lib/cn';
import { formatDateTime, formatNumber } from '../../lib/format';
import { nearblocksTxUrl } from '../../lib/near';
import { Callout, ExtLink } from './bits';

const decimalsFor = (asset: string) => (asset === 'USDC' || asset === 'USDT' ? 2 : asset === 'NEAR' ? 4 : 6);

function SignedAmount({ m }: { m: Movement }) {
  const { locale } = useI18n();
  const sign = m.direction === 'in' ? '+' : '−';
  return (
    <span className={cn('num font-medium whitespace-nowrap', m.direction === 'in' ? 'text-accent-strong' : m.flagged ? 'text-danger' : 'text-fg')}>
      {sign}
      {formatNumber(m.amount, locale, decimalsFor(m.asset))} <span className="text-xs font-normal text-muted">{m.asset}</span>
    </span>
  );
}

function Direction({ m }: { m: Movement }) {
  const { t } = useI18n();
  const Icon = m.direction === 'in' ? ArrowDownLeft : ArrowUpRight;
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <Icon aria-hidden className={cn('size-4 shrink-0', m.direction === 'in' ? 'text-accent-strong' : 'text-muted')} />
      {t(`treasury.movements.dir.${m.direction}`)}
    </span>
  );
}

/** What the movement is, with a link to the payment when Tesorero sent it. */
function Kind({ m }: { m: Movement }) {
  const { t } = useI18n();
  if (m.flagged) {
    return (
      <Chip tone="danger" icon={Siren} testId="movement-flag">
        {t('treasury.movements.flagged')}
      </Chip>
    );
  }
  if (m.kind === 'payment') {
    const label = m.reference ? t('treasury.movements.kind.paymentRef', { reference: m.reference }) : t('treasury.movements.kind.payment');
    return m.paymentId ? (
      <Link to={`/payments/${m.paymentId}`} className="relative z-10 text-sm font-medium text-accent-strong hover:underline" data-testid="movement-payment-link">
        {label}
      </Link>
    ) : (
      <span className="text-sm">{label}</span>
    );
  }
  return <span className="text-sm">{t(`treasury.movements.kind.${m.kind}`)}</span>;
}

function TxLink({ hash }: { hash: string }) {
  const { t } = useI18n();
  return (
    <ExtLink href={nearblocksTxUrl(hash)} className="text-xs">
      {t('treasury.movements.tx')}
    </ExtLink>
  );
}

function MovementsList({ data }: { data: TreasuryMovements }) {
  const { t, locale } = useI18n();
  if (data.items.length === 0) {
    return <EmptyState icon={History} title={t('treasury.movements.empty')} description={t('treasury.movements.emptyBody')} className="py-8" />;
  }
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('treasury.movements.title')}</caption>
          <thead className="border-y border-border bg-surface-2/60 text-left text-xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">{t('treasury.movements.date')}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{t('treasury.movements.direction')}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{t('treasury.movements.what')}</th>
              <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">{t('treasury.movements.counterparty')}</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">{t('treasury.movements.amount')}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                <span className="sr-only">{t('treasury.movements.tx')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.items.map((m) => (
              <tr
                key={`${m.txHash}-${m.asset}-${m.direction}`}
                data-testid="movement-row"
                data-flagged={m.flagged}
                className={cn(m.flagged && 'bg-danger-soft shadow-[inset_4px_0_0_var(--tz-danger)]')}
              >
                <td className="px-4 py-3 text-xs whitespace-nowrap text-muted">{formatDateTime(m.at, locale)}</td>
                <td className="px-4 py-3">
                  <Direction m={m} />
                </td>
                <td className="px-4 py-3">
                  <Kind m={m} />
                </td>
                <td className="hidden px-4 py-3 lg:table-cell">
                  {m.counterparty ? <Address value={m.counterparty} head={10} tail={6} label={t('treasury.movements.counterparty')} /> : <span className="text-muted">—</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  <SignedAmount m={m} />
                </td>
                <td className="px-4 py-3">
                  <TxLink hash={m.txHash} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 px-4 pb-4 md:hidden">
        {data.items.map((m) => (
          <li
            key={`${m.txHash}-${m.asset}-${m.direction}`}
            data-testid="movement-card"
            data-flagged={m.flagged}
            className={cn('rounded-[10px] border p-3', m.flagged ? 'border-danger/60 bg-danger-soft' : 'border-border')}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <Kind m={m} />
                <p className="text-xs text-muted">
                  {formatDateTime(m.at, locale)} · <Direction m={m} />
                </p>
              </div>
              <SignedAmount m={m} />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              {m.counterparty ? <Address value={m.counterparty} head={8} tail={6} label={t('treasury.movements.counterparty')} /> : <span />}
              <TxLink hash={m.txHash} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function MovementsCard({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const query = useTreasuryMovements(enabled);
  return (
    <Card role="region" aria-labelledby="movements-title" data-testid="treasury-movements" id="movements" className="scroll-mt-20">
      <CardHeader
        id="movements-title"
        title={t('treasury.movements.title')}
        description={t('treasury.movements.subtitle')}
        icon={<History aria-hidden className="mt-0.5 size-5 text-muted" />}
      />
      <div className="pt-3">
        <QueryView query={query} className="px-4 pb-4">
          {(data) => (
            <>
              {data.error ? (
                <Callout tone="warning" icon={CloudOff} title={t('treasury.movements.errorTitle')} className="mx-4 mb-3 sm:mx-5" testId="movements-error">
                  {t('treasury.movements.errorBody', { error: data.error })}
                </Callout>
              ) : null}
              <MovementsList data={data} />
            </>
          )}
        </QueryView>
      </div>
    </Card>
  );
}

/** Top-of-page alarm when USDC left the treasury without Tesorero sending it. */
export function MovementsAlertBanner({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const { data } = useTreasuryMovements(enabled);
  if (!data || data.alerts <= 0) return null;
  return (
    <div role="alert" className="rounded-[10px] border-2 border-danger bg-danger-soft p-4 text-danger" data-testid="movements-alert">
      <p className="flex items-center gap-2 text-md font-semibold">
        <Siren aria-hidden className="size-5 shrink-0" />
        {t('treasury.alert.title', { count: data.alerts })}
      </p>
      <p className="mt-1 text-sm text-fg">{t('treasury.alert.body')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link to="/policies" className={buttonClasses('danger', 'sm')} data-testid="movements-alert-pause">
          {t('treasury.alert.pause')}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
        <a href="#movements" className={buttonClasses('secondary', 'sm')}>
          {t('treasury.alert.review')}
        </a>
      </div>
    </div>
  );
}
