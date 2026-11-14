import { Bot, Check, Lock, TriangleAlert, Vault, Wallet, type LucideIcon } from 'lucide-react';
import type { TreasuryOverview } from '../../api/types';
import { Card, CardHeader } from '../../components/ui/Card';
import { Address } from '../../components/ui/Misc';
import { useI18n, type TranslationKey } from '../../i18n';
import { cn } from '../../lib/cn';
import { nearblocksAccountUrl } from '../../lib/near';
import { ExtLink } from './bits';

interface AccountTileProps {
  n: number;
  id: 'owner' | 'treasury' | 'agent';
  icon: LucideIcon;
  value: string | null;
  /** Shown instead of the value when it does not exist yet. */
  missing: string;
  /** Small note under the value (e.g. "will be created in step 3"). */
  note?: string | null;
  points: { key: TranslationKey; warn?: boolean; icon?: LucideIcon }[];
  accent?: boolean;
}

function AccountTile({ n, id, icon: Icon, value, missing, note, points, accent }: AccountTileProps) {
  const { t } = useI18n();
  const title = t(`treasury.accounts.${id}.title`);
  return (
    <li
      className={cn('flex min-w-0 flex-col rounded-[10px] border p-4', accent ? 'border-accent/40 bg-accent-soft/40' : 'border-border')}
      data-testid={`account-${id}`}
    >
      <div className="flex items-start gap-3">
        <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2">
          <Icon aria-hidden className="size-5" />
          <span aria-hidden className="num absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-fg text-xs font-semibold text-bg">
            {n}
          </span>
        </span>
        <div className="min-w-0">
          <h3 className="font-semibold">
            <span className="sr-only">{n}. </span>
            {title}
          </h3>
          <p className="text-sm text-muted">{t(`treasury.accounts.${id}.tag`)}</p>
        </div>
      </div>
      <div className="mt-3 min-w-0">
        {value ? (
          <div className="flex flex-wrap items-center gap-x-2">
            <Address value={value} head={10} tail={6} label={title} />
            <ExtLink href={nearblocksAccountUrl(value)} className="text-xs">
              NearBlocks
            </ExtLink>
          </div>
        ) : (
          <p className="text-sm text-muted italic">{missing}</p>
        )}
        {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
      </div>
      <ul className="mt-3 space-y-2 text-sm">
        {points.map(({ key, warn, icon: PointIcon }) => {
          const I = PointIcon ?? (warn ? TriangleAlert : Check);
          return (
            <li key={key} className={cn('flex gap-2', warn && 'font-medium text-warning')}>
              <I aria-hidden className={cn('mt-0.5 size-4 shrink-0', warn ? 'text-warning' : 'text-accent-strong')} />
              <span className="min-w-0">{t(key)}</span>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/** "How your money is organized": the three NEAR accounts, in plain language. */
export function AccountsCard({ data }: { data: TreasuryOverview }) {
  const { t } = useI18n();
  const pendingTreasury = !data.treasuryAccountId && data.setup ? data.setup.accountId : null;
  return (
    <Card role="region" aria-labelledby="treasury-accounts-title" data-testid="treasury-accounts">
      <CardHeader id="treasury-accounts-title" title={t('treasury.accounts.title')} description={t('treasury.accounts.subtitle')} />
      <ul className="grid gap-3 p-4 sm:p-5 xl:grid-cols-3">
        <AccountTile
          n={1}
          id="owner"
          icon={Wallet}
          value={data.ownerAccountId}
          missing={t('treasury.accounts.owner.missing')}
          points={[
            { key: 'treasury.accounts.owner.p1' },
            { key: 'treasury.accounts.owner.p2' },
            { key: 'treasury.accounts.owner.p3', warn: true },
          ]}
        />
        <AccountTile
          n={2}
          id="treasury"
          icon={Vault}
          accent
          value={data.treasuryAccountId ?? pendingTreasury}
          note={pendingTreasury ? t('treasury.accounts.treasury.pending') : null}
          missing={t('treasury.accounts.treasury.missing')}
          points={[
            { key: 'treasury.accounts.treasury.p1' },
            { key: 'treasury.accounts.treasury.p2' },
            { key: 'treasury.accounts.treasury.p3', icon: Lock },
          ]}
        />
        <AccountTile
          n={3}
          id="agent"
          icon={Bot}
          value={data.agentAccountId}
          missing={t('treasury.accounts.agent.missing')}
          points={[
            { key: 'treasury.accounts.agent.p1' },
            { key: 'treasury.accounts.agent.p2' },
            { key: 'treasury.accounts.agent.p3', warn: true },
          ]}
        />
      </ul>
      <p className="border-t border-border px-4 py-3 text-sm text-muted sm:px-5">{t('treasury.accounts.flow')}</p>
    </Card>
  );
}
