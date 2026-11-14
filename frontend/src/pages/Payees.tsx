import { Archive, Clock, Pencil, ShieldCheck, ShieldOff, UserPlus, Users } from 'lucide-react';
import { useId, useMemo, useState, type SubmitEvent } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { useArchivePayee, usePayees, usePolicy, useSavePayee, useTokens } from '../api/queries';
import { CATEGORIES, type Category, type Payee, type PayeeInput, type Token } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { GuardedButton } from '../components/GuardedButton';
import { QueryView } from '../components/QueryView';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { Dialog } from '../components/ui/Dialog';
import { controlClasses, describedBy, SelectField, SwitchField, TextareaField, TextField } from '../components/ui/Field';
import { Address, PageHeader } from '../components/ui/Misc';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState, ErrorState } from '../components/ui/States';
import { useToast } from '../components/ui/Toast';
import { useI18n, type TFunction } from '../i18n';
import { cn } from '../lib/cn';
import { chainName, isDeprecated, isStablecoin, recommendedTokens } from '../lib/chains';
import { hoursSince } from '../lib/format';
import { useNow } from '../lib/useNow';
import { normalize } from '../components/layout/CommandPalette';

const EVM_CHAINS = new Set(['eth', 'base', 'arb', 'op', 'pol', 'bsc', 'avax', 'gnosis', 'bera', 'monad', 'xlayer', 'plasma']);
const NEAR_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_RECENT_HOURS = 72;

/** Light client-side address check; the server is authoritative (AddressRules per chain). */
export function addressLooksValid(chain: string, address: string): boolean {
  const a = address.trim();
  if (!a) return false;
  if (EVM_CHAINS.has(chain.toLowerCase())) return /^0x[0-9a-fA-F]{40}$/.test(a);
  if (chain.toLowerCase() === 'near') return NEAR_ACCOUNT.test(a) || /^[0-9a-f]{64}$/.test(a);
  if (chain.toLowerCase() === 'sol') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
  return a.length >= 3;
}

interface PayeeFormState {
  name: string;
  email: string;
  category: Category;
  destinationAssetId: string;
  recipientAddress: string;
  isAllowlisted: boolean;
  notes: string;
}

type PayeeErrors = Partial<Record<keyof PayeeFormState, string>>;

function validatePayee(s: PayeeFormState, token: Token | undefined, t: TFunction): PayeeErrors {
  const e: PayeeErrors = {};
  if (!s.name.trim()) e.name = t('validation.nameRequired');
  else if (s.name.trim().length > 120) e.name = t('validation.tooLong', { max: 120 });
  if (s.email.trim() && !EMAIL.test(s.email.trim())) e.email = t('validation.email');
  if (!s.destinationAssetId || !token) e.destinationAssetId = t('validation.tokenRequired');
  if (!s.recipientAddress.trim()) e.recipientAddress = t('validation.addressRequired');
  else if (token && !addressLooksValid(token.blockchain, s.recipientAddress)) {
    e.recipientAddress = t('validation.addressInvalid', { chain: chainName(token.blockchain) });
  }
  if (s.notes.length > 500) e.notes = t('validation.tooLong', { max: 500 });
  return e;
}

/**
 * Short, human-checkable contract id taken from the NEAR Intents asset id, so look-alike tokens
 * ("USDC", "sUSDC", "sparkUSDC") can be told apart: nep141:base-0x8335…2913.omft.near → 0x8335…2913.
 */
export function shortContract(assetId: string): string {
  const evm = /0x[0-9a-fA-F]{40}/.exec(assetId);
  if (evm) return `${evm[0].slice(0, 6)}…${evm[0].slice(-4)}`;
  const body = assetId.replace(/^nep\d+:/, '').replace(/\.omft\.near$|\.omdep\.near$/, '');
  const tail = body.includes('-') ? body.slice(body.indexOf('-') + 1) : body;
  return tail.length > 14 ? `${tail.slice(0, 6)}…${tail.slice(-4)}` : tail;
}

/** Exact symbol matches first, then symbols that start with the query, then the rest. */
export function rankTokens(tokens: Token[], query: string): Token[] {
  const q = normalize(query.trim());
  const filtered = q ? tokens.filter((tk) => normalize(`${tk.symbol} ${tk.blockchain} ${chainName(tk.blockchain)}`).includes(q)) : tokens;
  const words = q.split(/\s+/).filter(Boolean);
  const score = (tk: Token) => {
    const sym = normalize(tk.symbol);
    if (words.some((w) => sym === w)) return 0;
    if (words.some((w) => sym.startsWith(w))) return 1;
    return 2;
  };
  return [...filtered].sort((a, b) => score(a) - score(b) || a.symbol.localeCompare(b.symbol) || a.blockchain.localeCompare(b.blockchain));
}

export interface TokenGroups {
  /** The chosen token when the current view would hide it (never lose sight of the choice). */
  selected: Token[];
  recommended: Token[];
  /** Other stablecoins, or every token with "Show all tokens". */
  others: Token[];
  /** Search results hidden because "Show all tokens" is off. */
  hiddenMatches: number;
}

/**
 * Groups for the supplier token picker: the recommended stablecoins first, then the other dollar
 * stablecoins; deprecated tokens and everything else only with "Show all tokens". Searching
 * filters, it never chooses.
 */
export function tokenGroups(tokens: Token[], search: string, showAll: boolean, value: string): TokenGroups {
  const recommended = recommendedTokens(tokens);
  const recIds = new Set(recommended.map((tk) => tk.assetId));
  const visible = (tk: Token) => showAll || (isStablecoin(tk) && !isDeprecated(tk));
  const rest = tokens.filter((tk) => !recIds.has(tk.assetId));
  const q = search.trim();
  const rec = q ? rankTokens(recommended, q) : recommended;
  const others = rankTokens(rest.filter(visible), q);
  const hiddenMatches = showAll || !q ? 0 : rankTokens(rest.filter((tk) => !visible(tk)), q).length;
  const chosen = tokens.find((tk) => tk.assetId === value);
  const shown = chosen !== undefined && (rec.includes(chosen) || others.includes(chosen));
  return { selected: chosen && !shown ? [chosen] : [], recommended: rec, others, hiddenMatches };
}

function TokenPicker({
  tokens,
  value,
  onChange,
  error,
}: {
  tokens: Token[];
  value: string;
  onChange: (assetId: string) => void;
  error?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const groups = useMemo(() => tokenGroups(tokens, search, showAll, value), [tokens, search, showAll, value]);
  const nothing = groups.selected.length + groups.recommended.length + groups.others.length === 0;

  // Radio buttons, not a <select>: phones turn a <select> into a one-line picker that shows the
  // first option as if it were chosen, and searching never picks anything for the person.
  const option = (tk: Token) => (
    <li key={tk.assetId}>
      <label
        className={cn(
          'flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-1.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
          tk.assetId === value ? 'bg-accent-soft' : 'hover:bg-surface-2',
        )}
        data-testid="token-option"
        data-asset={tk.assetId}
      >
        <input
          type="radio"
          name={`${id}-token`}
          value={tk.assetId}
          checked={tk.assetId === value}
          onChange={() => onChange(tk.assetId)}
          aria-label={`${tk.symbol} · ${chainName(tk.blockchain)} · ${shortContract(tk.assetId)}`}
          className="size-4 shrink-0 accent-[var(--tz-accent-strong)]"
        />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{tk.symbol}</span>
          <span className="text-muted"> · </span>
          <span>{chainName(tk.blockchain)}</span>
        </span>
        <span className="num hidden shrink-0 text-xs text-muted sm:inline">{shortContract(tk.assetId)}</span>
      </label>
    </li>
  );
  const group = (title: string, list: Token[], testId: string) =>
    list.length === 0 ? null : (
      <div data-testid={testId}>
        <p className="px-2.5 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">{title}</p>
        <ul>{list.map(option)}</ul>
      </div>
    );

  return (
    <fieldset
      className="min-w-0 space-y-1.5 sm:col-span-2"
      aria-describedby={describedBy(`${id}-tokens`, true, error)}
      aria-invalid={error ? true : undefined}
      data-testid="token-picker"
    >
      <legend className="mb-1.5 block text-sm font-medium text-fg">
        {t('payees.token')}
        <span aria-hidden className="ml-0.5 text-danger">
          *
        </span>
      </legend>
      <input
        type="search"
        aria-label={t('payees.tokenSearch')}
        placeholder={t('payees.tokenSearch')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={cn(controlClasses, 'mb-2')}
        data-testid="token-search"
      />
      <div className={cn('max-h-72 overflow-y-auto rounded-lg border p-1', error ? 'border-danger' : 'border-border')}>
        {group(t('payees.tokenSelected'), groups.selected, 'token-group-selected')}
        {group(t('payees.tokenRecommended'), groups.recommended, 'token-group-recommended')}
        {group(showAll ? t('payees.tokenAll') : t('payees.tokenOtherStable'), groups.others, 'token-group-others')}
        {nothing ? <p className="px-2.5 py-3 text-sm text-muted">{t('payees.noTokens')}</p> : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={`${id}-tokens-hint`} className="text-xs text-muted">
          {value ? t('payees.tokenHint') : t('payees.tokenChoose')}
        </p>
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          aria-pressed={showAll}
          className="inline-flex min-h-11 items-center text-sm font-medium text-accent-strong hover:underline pointer-fine:min-h-0"
          data-testid="token-show-all"
        >
          {showAll ? t('payees.tokenShowFewer') : groups.hiddenMatches > 0 ? t('payees.tokenShowAllCount', { count: groups.hiddenMatches }) : t('payees.tokenShowAll')}
        </button>
      </div>
      {error ? (
        <p id={`${id}-tokens-error`} className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function PayeeDialog({ payee, allow = false, onClose }: { payee: Payee | null; /** Opened from "Allow this supplier". */ allow?: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const tokens = useTokens();
  const policy = usePolicy();
  const save = useSavePayee();
  const [form, setForm] = useState<PayeeFormState>(() => ({
    name: payee?.name ?? '',
    email: payee?.email ?? '',
    category: payee?.category ?? 'Supplier',
    destinationAssetId: payee?.destinationAssetId ?? '',
    recipientAddress: payee?.recipientAddress ?? '',
    // A supplier the Owner adds is one she trusts: automatic payments on by default (she can turn it off).
    isAllowlisted: allow || (payee?.isAllowlisted ?? true),
    notes: payee?.notes ?? '',
  }));
  const [errors, setErrors] = useState<PayeeErrors>({});
  const set = <K extends keyof PayeeFormState>(k: K, v: PayeeFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const token = tokens.data?.find((tk) => tk.assetId === form.destinationAssetId);
  const destinationChanged =
    payee !== null && (payee.recipientAddress !== form.recipientAddress.trim() || payee.destinationAssetId !== form.destinationAssetId);
  const cooldown = policy.data?.newPayeeCooldownHours ?? DEFAULT_RECENT_HOURS;

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = validatePayee(form, token, t);
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    const input: PayeeInput = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      category: form.category,
      destinationAssetId: form.destinationAssetId,
      recipientAddress: form.recipientAddress.trim(),
      isAllowlisted: form.isAllowlisted,
      notes: form.notes.trim() || null,
    };
    save.mutate(
      { id: payee?.id, input },
      {
        onSuccess: (saved) => {
          toast({ title: payee ? t('payees.updated') : t('payees.created'), description: saved.name, tone: 'success' });
          onClose();
        },
        onError: (err) => {
          if (err instanceof ApiError) setErrors(err.fieldErrors);
          toast({ title: t('payees.saveFailed'), description: err.message, tone: 'error' });
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={payee ? t('payees.edit') : t('payees.new')}
      description={t('payees.formHint')}
      testId="payee-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="payee-form" variant="primary" loading={save.isPending} data-testid="payee-form-submit">
            {payee ? t('common.save') : t('payees.create')}
          </Button>
        </>
      }
    >
      <form id="payee-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('payees.name')} required value={form.name} error={errors.name} onChange={(e) => set('name', e.target.value)} autoComplete="organization" />
        <TextField label={t('payees.email')} type="email" value={form.email} error={errors.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" />
        <SelectField label={t('bills.category')} required value={form.category} onChange={(e) => set('category', e.target.value as Category)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`category.${c}`)}
            </option>
          ))}
        </SelectField>
        <div className="hidden sm:block" />
        {tokens.isPending ? (
          <Skeleton className="h-52 sm:col-span-2" />
        ) : tokens.isError ? (
          <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} className="py-4 sm:col-span-2" />
        ) : (
          <TokenPicker tokens={tokens.data} value={form.destinationAssetId} onChange={(v) => set('destinationAssetId', v)} error={errors.destinationAssetId} />
        )}
        <TextField
          label={t('payees.recipient')}
          required
          className="num"
          containerClassName="sm:col-span-2"
          value={form.recipientAddress}
          error={errors.recipientAddress}
          hint={
            <>
              {token ? <span className="block">{t('payees.recipientHint', { symbol: token.symbol, chain: chainName(token.blockchain) })}</span> : null}
              <span className="block">{t('payees.verifiedByIntents')}</span>
            </>
          }
          data-testid="payee-recipient"
          onChange={(e) => set('recipientAddress', e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        {destinationChanged ? (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning sm:col-span-2" role="status">
            <Clock aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('payees.changeWarning', { hours: cooldown })}
          </p>
        ) : null}
        <SwitchField
          label={t('payees.allowlisted')}
          hint={t('payees.allowlistedHint')}
          checked={form.isAllowlisted}
          onChange={(e) => set('isAllowlisted', e.target.checked)}
          className="sm:col-span-2"
          data-testid="payee-allowlisted"
        />
        {allow ? (
          <p className="flex items-start gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-sm sm:col-span-2" role="status" data-testid="payee-allow-note">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-strong" />
            {t('payees.allowNote')}
          </p>
        ) : null}
        <TextareaField label={t('payees.notes')} rows={2} value={form.notes} error={errors.notes} onChange={(e) => set('notes', e.target.value)} containerClassName="sm:col-span-2" />
      </form>
    </Dialog>
  );
}

function RecencyBadge({ payee, recentHours, now }: { payee: Payee; recentHours: number; now: number }) {
  const { t } = useI18n();
  const hours = hoursSince(payee.addressChangedAt, now);
  if (hours >= recentHours) return null;
  const isNew = Math.abs(Date.parse(payee.addressChangedAt) - Date.parse(payee.createdAt)) < 60_000;
  return (
    <Chip tone="warning" icon={Clock} testId="address-changed-badge">
      {isNew ? t('payees.addedAgo', { hours }) : t('payees.changedAgo', { hours })}
    </Chip>
  );
}

function AllowChip({ allowlisted }: { allowlisted: boolean }) {
  const { t } = useI18n();
  return allowlisted ? (
    <Chip tone="success" icon={ShieldCheck}>
      {t('payees.allowlistedShort')}
    </Chip>
  ) : (
    <Chip tone="neutral" icon={ShieldOff}>
      {t('payees.notAllowlisted')}
    </Chip>
  );
}

export function PayeesPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast } = useToast();
  const payees = usePayees();
  const policy = usePolicy();
  const archive = useArchivePayee();
  const now = useNow();
  const [editing, setEditing] = useState<Payee | 'new' | null>(null);
  // "Allow this supplier" (from a blocked payment) links here: /payees?edit=<id>&allow=1
  const [params, setParams] = useSearchParams();
  const editParam = params.get('edit');
  const fromLink = can('payees.manage') && editParam ? (payees.data?.find((p) => p.id === editParam) ?? null) : null;
  const shownEditing = editing ?? fromLink;
  const allowFromLink = editing === null && fromLink !== null && params.get('allow') === '1';
  const closeEditor = () => {
    setEditing(null);
    if (params.has('edit')) {
      setParams(
        (p) => {
          p.delete('edit');
          p.delete('allow');
          return p;
        },
        { replace: true },
      );
    }
  };
  const [archiving, setArchiving] = useState<Payee | null>(null);
  const recentHours = policy.data?.newPayeeCooldownHours ?? DEFAULT_RECENT_HOURS;
  const manage = can('payees.manage');

  const confirmArchive = () => {
    if (!archiving) return;
    const p = archiving;
    archive.mutate(p.id, {
      onSuccess: () => {
        toast({ title: t('payees.archived'), description: p.name, tone: 'success' });
        setArchiving(null);
      },
      onError: (err) => toast({ title: t('payees.archiveFailed'), description: err.message, tone: 'error' }),
    });
  };

  const actions = (p: Payee) =>
    manage ? (
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(p)} aria-label={t('payees.editNamed', { name: p.name })}>
          <span className="hidden xl:inline">{t('common.edit')}</span>
        </Button>
        <Button size="sm" variant="ghost" icon={Archive} onClick={() => setArchiving(p)} aria-label={t('payees.archiveNamed', { name: p.name })}>
          <span className="hidden xl:inline">{t('payees.archive')}</span>
        </Button>
      </div>
    ) : null;

  return (
    <>
      <PageHeader
        title={t('payees.title')}
        description={t('payees.subtitle')}
        actions={
          <GuardedButton permission="payees.manage" variant="primary" icon={UserPlus} onClick={() => setEditing('new')} data-testid="new-payee-button">
            {t('payees.new')}
          </GuardedButton>
        }
      />
      <QueryView query={payees}>
        {(list) =>
          list.length === 0 ? (
            <Card>
              <EmptyState icon={Users} title={t('payees.empty')} description={t('payees.emptyBody')} />
            </Card>
          ) : (
            <>
              <Card className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('payees.title')}</caption>
                  <thead className="border-b border-border bg-surface-2/60 text-left text-xs text-muted">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-medium">{t('payees.name')}</th>
                      <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">{t('bills.category')}</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">{t('payees.destination')}</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">{t('payees.trust')}</th>
                      <th scope="col" className="px-4 py-2.5"><span className="sr-only">{t('common.actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {list.map((p) => (
                      <tr key={p.id} className="hover:bg-surface-2/40" data-testid="payee-row">
                        <td className="px-4 py-3">
                          <div className="font-medium">{p.name}</div>
                          {p.email ? <div className="text-xs text-muted">{p.email}</div> : null}
                        </td>
                        <td className="hidden px-4 py-3 lg:table-cell">{t(`category.${p.category}`)}</td>
                        <td className="px-4 py-3">
                          <div className="text-sm">
                            {p.destinationSymbol} · {chainName(p.destinationChain)}
                          </div>
                          <Address value={p.recipientAddress} label={t('payees.recipient')} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <AllowChip allowlisted={p.isAllowlisted} />
                            <RecencyBadge payee={p} recentHours={recentHours} now={now} />
                          </div>
                        </td>
                        <td className="px-2 py-3">{actions(p)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <ul className="space-y-3 md:hidden">
                {list.map((p) => (
                  <li key={p.id}>
                    <Card className="p-4" data-testid="payee-card">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.name}</p>
                          <p className="text-xs text-muted">
                            {t(`category.${p.category}`)} · {p.destinationSymbol} · {chainName(p.destinationChain)}
                          </p>
                        </div>
                      </div>
                      <Address value={p.recipientAddress} label={t('payees.recipient')} className="mt-1" />
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <AllowChip allowlisted={p.isAllowlisted} />
                        <RecencyBadge payee={p} recentHours={recentHours} now={now} />
                      </div>
                      {manage ? <div className="mt-2 border-t border-border pt-2">{actions(p)}</div> : null}
                    </Card>
                  </li>
                ))}
              </ul>
            </>
          )
        }
      </QueryView>

      {shownEditing ? (
        <PayeeDialog
          key={shownEditing === 'new' ? 'new' : shownEditing.id}
          payee={shownEditing === 'new' ? null : shownEditing}
          allow={allowFromLink}
          onClose={closeEditor}
        />
      ) : null}

      <Dialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        size="sm"
        title={t('payees.archiveTitle')}
        footer={
          <>
            <Button onClick={() => setArchiving(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" icon={Archive} loading={archive.isPending} onClick={confirmArchive}>
              {t('payees.archive')}
            </Button>
          </>
        }
      >
        <p className="text-sm">{archiving ? t('payees.archiveBody', { name: archiving.name }) : null}</p>
      </Dialog>
    </>
  );
}
