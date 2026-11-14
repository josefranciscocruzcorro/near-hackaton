import { CircleCheck, CircleX, Loader2, MailCheck, RotateCcw, Send, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode, type SubmitEvent } from 'react';
import { ApiError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type { NearAccountCheck, SignupLanguage, SignupRequest, SlugCheck } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { controlClasses, describedBy, FieldShell, SelectField, TextField } from '../../components/ui/Field';
import { LANGS, useI18n, type TFunction } from '../../i18n';
import { richText } from '../../i18n/rich';
import { cn } from '../../lib/cn';
import { isValidNearAccountId, isValidSlug, normalizeSlugInput, slugify } from '../../lib/slug';
import { useLiveCheck, type LiveCheck } from '../../lib/useLiveCheck';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 120;

/** Id of the first signup field — the hero CTA moves focus here. */
export const SIGNUP_FIRST_FIELD_ID = 'signup-organization';

// Clearly malformed values never reach the server; they resolve locally after the same debounce.
const checkSlug = (value: string, signal: AbortSignal): Promise<SlugCheck> =>
  isValidSlug(value) ? endpoints.checkSlug(value, signal) : Promise.resolve({ slug: value, available: false, reason: 'invalid' });

const checkNear = (value: string, signal: AbortSignal): Promise<NearAccountCheck> =>
  isValidNearAccountId(value)
    ? endpoints.checkNearAccount(value, signal)
    : Promise.resolve({ accountId: value, exists: false, valid: false });

export type SlugStatus = 'empty' | 'checking' | 'available' | 'taken' | 'reserved' | 'invalid' | 'error';
export type NearStatus = 'empty' | 'checking' | 'exists' | 'notFound' | 'invalid' | 'error';

export function slugStatusOf(state: LiveCheck<SlugCheck>): SlugStatus {
  switch (state.status) {
    case 'idle':
      return 'empty';
    case 'checking':
      return 'checking';
    case 'error':
      return 'error';
    case 'done':
      return state.result.available ? 'available' : (state.result.reason ?? 'taken');
  }
}

export function nearStatusOf(state: LiveCheck<NearAccountCheck>): NearStatus {
  switch (state.status) {
    case 'idle':
      return 'empty';
    case 'checking':
      return 'checking';
    case 'error':
      return 'error';
    case 'done':
      return !state.result.valid ? 'invalid' : state.result.exists ? 'exists' : 'notFound';
  }
}

interface FormState {
  organizationName: string;
  slug: string;
  ownerName: string;
  email: string;
  nearAccountId: string;
  acceptTerms: boolean;
  website: string;
}

type FieldKey = 'organizationName' | 'slug' | 'ownerName' | 'email' | 'nearAccountId' | 'acceptTerms';
type Errors = Partial<Record<FieldKey, string>>;

const EMPTY: FormState = { organizationName: '', slug: '', ownerName: '', email: '', nearAccountId: '', acceptTerms: false, website: '' };

function validate(f: FormState, t: TFunction): Errors {
  const e: Errors = {};
  if (!f.organizationName.trim()) e.organizationName = t('validation.nameRequired');
  else if (f.organizationName.trim().length > MAX_NAME) e.organizationName = t('validation.tooLong', { max: MAX_NAME });
  if (!f.ownerName.trim()) e.ownerName = t('validation.nameRequired');
  else if (f.ownerName.trim().length > MAX_NAME) e.ownerName = t('validation.tooLong', { max: MAX_NAME });
  if (!EMAIL.test(f.email.trim())) e.email = t('validation.email');
  if (!f.acceptTerms) e.acceptTerms = t('signup.termsRequired');
  return e;
}

type Tone = 'muted' | 'success' | 'danger' | 'warning';
const TONE: Record<Tone, string> = {
  muted: 'text-muted',
  success: 'text-accent-strong',
  danger: 'text-danger',
  warning: 'text-warning',
};

/** Live check result line: icon + text (never colour alone), announced politely. */
function CheckLine({
  id,
  testId,
  status,
  tone,
  icon: Icon,
  spin,
  children,
  onRetry,
}: {
  id: string;
  testId: string;
  status: string;
  tone: Tone;
  icon: LucideIcon | null;
  spin?: boolean;
  children: ReactNode;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div id={id} data-testid={testId} data-status={status} aria-live="polite" className={cn('min-h-5 text-xs font-medium', TONE[tone])}>
      {children ? (
        <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {Icon ? <Icon aria-hidden className={cn('size-3.5 shrink-0', spin && 'animate-spin')} /> : null}
          <span>{children}</span>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="inline-flex min-h-6 items-center gap-1 rounded underline underline-offset-2 hover:text-fg">
              <RotateCcw aria-hidden className="size-3" />
              {t('signup.check.retry')}
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export function SignupSection({ baseDomain }: { baseDomain: string }) {
  const { t, lang } = useI18n();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [slugEdited, setSlugEdited] = useState(false);
  const [languageChoice, setLanguageChoice] = useState<SignupLanguage | null>(null);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const ids = { slug: useId(), near: useId(), hp: useId(), hint: useId() };
  const language: SignupLanguage = languageChoice ?? lang;

  // Until the person edits it, the subdomain follows the organization name.
  const slug = slugEdited ? form.slug : slugify(form.organizationName);
  const nearId = form.nearAccountId.trim().toLowerCase();
  const slugLive = useLiveCheck(slug, checkSlug);
  const nearLive = useLiveCheck(nearId, checkNear);
  const slugStatus = slugStatusOf(slugLive.state);
  const nearStatus = nearStatusOf(nearLive.state);
  const host = `${slug}.${baseDomain}`;

  const local = validate(form, t);
  const shown = (k: FieldKey): string | undefined => serverErrors[k] ?? (touched[k] ? local[k] : undefined);
  const fieldServerError = (['organizationName', 'slug', 'ownerName', 'email', 'nearAccountId', 'acceptTerms'] as const).some(
    (k) => serverErrors[k] !== undefined,
  );
  const canSubmit =
    Object.keys(local).length === 0 && slugStatus === 'available' && nearStatus === 'exists' && !fieldServerError && !pending;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFormError(null);
    // Editing a field clears its server error (and the derived subdomain's, while it follows the name).
    setServerErrors((e) =>
      Object.fromEntries(Object.entries(e).filter(([key]) => key !== k && !(key === 'slug' && k === 'organizationName' && !slugEdited))),
    );
  };
  const touch = (k: FieldKey) => setTouched((s) => (s[k] ? s : { ...s, [k]: true }));

  const onSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setFormError(null);
    const body: SignupRequest = {
      organizationName: form.organizationName.trim(),
      slug,
      ownerName: form.ownerName.trim(),
      email: form.email.trim(),
      nearAccountId: nearId,
      language,
      acceptTerms: form.acceptTerms,
      website: form.website,
    };
    try {
      const res = await endpoints.signup(body);
      setSentTo(res.email);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setFormError(t('signup.rateLimited'));
      } else if (err instanceof ApiError && err.status === 400 && Object.keys(err.fieldErrors).length > 0) {
        setServerErrors(err.fieldErrors);
        setFormError(t('signup.fixFields'));
      } else if (err instanceof ApiError && err.status === 0) {
        setFormError(t('error.network'));
      } else {
        setFormError(err instanceof ApiError ? err.message : t('error.generic'));
      }
    } finally {
      setPending(false);
    }
  };

  const slugLine = (() => {
    if (serverErrors.slug) return null;
    switch (slugStatus) {
      case 'empty':
        return { tone: 'muted' as const, icon: null, text: null };
      case 'checking':
        return { tone: 'muted' as const, icon: Loader2, spin: true, text: t('signup.slug.checking') };
      case 'available':
        return { tone: 'success' as const, icon: CircleCheck, text: richText(t('signup.slug.available'), { host: <span className="num">{host}</span> }) };
      case 'taken':
        return { tone: 'danger' as const, icon: CircleX, text: richText(t('signup.slug.taken'), { host: <span className="num">{host}</span> }) };
      case 'reserved':
        return { tone: 'danger' as const, icon: CircleX, text: t('signup.slug.reserved', { slug }) };
      case 'invalid':
        return { tone: 'danger' as const, icon: CircleX, text: t('signup.slug.invalid') };
      case 'error':
        return { tone: 'warning' as const, icon: TriangleAlert, text: t('signup.check.error'), retry: slugLive.retry };
    }
  })();

  const nearLine = (() => {
    if (serverErrors.nearAccountId) return null;
    const account = <span className="num">{nearId}</span>;
    switch (nearStatus) {
      case 'empty':
        return { tone: 'muted' as const, icon: null, text: null };
      case 'checking':
        return { tone: 'muted' as const, icon: Loader2, spin: true, text: t('signup.near.checking') };
      case 'exists':
        return { tone: 'success' as const, icon: CircleCheck, text: richText(t('signup.near.exists'), { account }) };
      case 'notFound':
        return { tone: 'danger' as const, icon: CircleX, text: richText(t('signup.near.notFound'), { account }) };
      case 'invalid':
        return { tone: 'danger' as const, icon: CircleX, text: t('signup.near.invalid') };
      case 'error':
        return { tone: 'warning' as const, icon: TriangleAlert, text: t('signup.check.error'), retry: nearLive.retry };
    }
  })();

  const slugInvalid = serverErrors.slug !== undefined || slugStatus === 'invalid' || slugStatus === 'taken' || slugStatus === 'reserved';
  const nearInvalid = serverErrors.nearAccountId !== undefined || nearStatus === 'invalid' || nearStatus === 'notFound';

  return (
    <section id="signup" aria-labelledby="signup-title" className="px-4 py-20 sm:px-6 lg:py-28">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <div className="lg:pt-6">
          <p className="num text-xs font-medium tracking-[0.14em] text-accent-strong uppercase">{t('signup.kicker')}</p>
          <h2 id="signup-title" className="mt-3 text-2xl font-semibold tracking-tight text-balance sm:text-[2.5rem] sm:leading-[1.1]">
            {t('signup.title')}
          </h2>
          <p className="mt-4 max-w-md text-md text-muted">
            {richText(t('signup.body'), { domain: <span className="num text-fg">{`*.${baseDomain}`}</span> })}
          </p>
          <ol className="mt-8 space-y-4">
            {(['signup.step1', 'signup.step2', 'signup.step3'] as const).map((k, i) => (
              <li key={k} className="flex items-center gap-3">
                <span aria-hidden className="num flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-xs text-accent-strong">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-base font-medium">{t(k)}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="min-w-0 rounded-[10px] border border-border bg-surface p-5 shadow-sm sm:p-7">
          {sentTo !== null ? (
            <SignupSuccess email={sentTo} onAgain={() => setSentTo(null)} />
          ) : (
            <form onSubmit={(e) => void onSubmit(e)} noValidate className="relative space-y-5" data-testid="signup-form">
              <TextField
                id={SIGNUP_FIRST_FIELD_ID}
                label={t('signup.org')}
                required
                value={form.organizationName}
                error={shown('organizationName')}
                onChange={(e) => set('organizationName', e.target.value)}
                onBlur={() => touch('organizationName')}
                autoComplete="organization"
                maxLength={MAX_NAME + 20}
                data-testid="signup-org"
              />

              <FieldShell id={ids.slug} label={t('signup.slug')} hint={t('signup.slugHint')} error={serverErrors.slug} required>
                <div
                  className={cn(
                    'flex min-h-11 w-full items-stretch overflow-hidden rounded-lg border bg-surface transition-colors pointer-fine:min-h-9',
                    'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent',
                    slugInvalid ? 'border-danger' : 'border-border hover:border-muted/60',
                  )}
                >
                  <input
                    id={ids.slug}
                    required
                    value={slug}
                    onChange={(e) => {
                      setSlugEdited(true);
                      set('slug', normalizeSlugInput(e.target.value));
                    }}
                    onBlur={() => touch('slug')}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    inputMode="url"
                    aria-invalid={slugInvalid || undefined}
                    aria-describedby={[`${ids.slug}-status`, describedBy(ids.slug, true, serverErrors.slug)].join(' ')}
                    className="num min-w-0 flex-1 bg-transparent px-3 text-base text-fg outline-none placeholder:text-muted/80"
                    placeholder={t('signup.slugPlaceholder')}
                    data-testid="signup-slug"
                  />
                  <span aria-hidden className="num flex shrink-0 items-center border-l border-border bg-surface-2 px-2.5 text-sm text-muted sm:px-3">
                    .{baseDomain}
                  </span>
                </div>
                <CheckLine
                  id={`${ids.slug}-status`}
                  testId="signup-slug-status"
                  status={serverErrors.slug ? 'server-error' : slugStatus}
                  tone={slugLine?.tone ?? 'muted'}
                  icon={slugLine?.icon ?? null}
                  spin={slugLine?.spin}
                  onRetry={slugLine?.retry}
                >
                  {slugLine?.text}
                </CheckLine>
              </FieldShell>

              <div className="grid gap-5 sm:grid-cols-2">
                <TextField
                  label={t('signup.name')}
                  required
                  value={form.ownerName}
                  error={shown('ownerName')}
                  onChange={(e) => set('ownerName', e.target.value)}
                  onBlur={() => touch('ownerName')}
                  autoComplete="name"
                  maxLength={MAX_NAME + 20}
                  data-testid="signup-name"
                />
                <TextField
                  label={t('signup.email')}
                  hint={t('signup.emailHint')}
                  type="email"
                  inputMode="email"
                  required
                  value={form.email}
                  error={shown('email')}
                  onChange={(e) => set('email', e.target.value)}
                  onBlur={() => touch('email')}
                  autoComplete="email"
                  spellCheck={false}
                  data-testid="signup-email"
                />
              </div>

              <FieldShell id={ids.near} label={t('signup.near')} hint={t('signup.nearHint')} error={serverErrors.nearAccountId} required>
                <input
                  id={ids.near}
                  required
                  value={form.nearAccountId}
                  onChange={(e) => set('nearAccountId', e.target.value)}
                  onBlur={() => touch('nearAccountId')}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={t('signup.nearPlaceholder')}
                  aria-invalid={nearInvalid || undefined}
                  aria-describedby={[`${ids.near}-status`, describedBy(ids.near, true, serverErrors.nearAccountId)].join(' ')}
                  className={cn(controlClasses, 'num')}
                  data-testid="signup-near"
                />
                <CheckLine
                  id={`${ids.near}-status`}
                  testId="signup-near-status"
                  status={serverErrors.nearAccountId ? 'server-error' : nearStatus}
                  tone={nearLine?.tone ?? 'muted'}
                  icon={nearLine?.icon ?? null}
                  spin={nearLine?.spin}
                  onRetry={nearLine?.retry}
                >
                  {nearLine?.text}
                </CheckLine>
              </FieldShell>

              <SelectField
                label={t('signup.language')}
                value={language}
                onChange={(e) => setLanguageChoice(e.target.value === 'es' ? 'es' : 'en')}
                data-testid="signup-language"
              >
                {LANGS.map((l) => (
                  <option key={l} value={l}>
                    {t(`lang.name.${l}`)}
                  </option>
                ))}
              </SelectField>

              <div>
                <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={form.acceptTerms}
                    onChange={(e) => {
                      set('acceptTerms', e.target.checked);
                      touch('acceptTerms');
                    }}
                    aria-invalid={shown('acceptTerms') ? true : undefined}
                    aria-describedby={shown('acceptTerms') ? 'signup-terms-error' : undefined}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--tz-accent-strong)]"
                    data-testid="signup-terms"
                  />
                  <span>{t('signup.terms')}</span>
                </label>
                {shown('acceptTerms') ? (
                  <p id="signup-terms-error" className="text-xs font-medium text-danger">
                    {shown('acceptTerms')}
                  </p>
                ) : null}
              </div>

              {/* Honeypot: invisible to people and assistive tech; bots that fill it are rejected server-side. */}
              <div aria-hidden="true" className="sr-only">
                <label htmlFor={ids.hp}>{t('signup.honeypot')}</label>
                <input
                  id={ids.hp}
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  value={form.website}
                  onChange={(e) => set('website', e.target.value)}
                  data-testid="signup-website"
                />
              </div>

              {formError ? (
                <p role="alert" data-testid="signup-error" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {formError}
                </p>
              ) : null}

              <div>
                <Button
                  type="submit"
                  variant="primary"
                  icon={Send}
                  loading={pending}
                  disabled={!canSubmit}
                  aria-describedby={!canSubmit && !pending ? ids.hint : undefined}
                  className="w-full"
                  data-testid="signup-submit"
                >
                  {t('signup.submit')}
                </Button>
                {!canSubmit && !pending ? (
                  <p id={ids.hint} className="mt-2 text-center text-xs text-muted">
                    {t('signup.submitHint')}
                  </p>
                ) : null}
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function SignupSuccess({ email, onAgain }: { email: string; onAgain: () => void }) {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <div data-testid="signup-success" role="status" className="flex flex-col items-start py-4 sm:py-8">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
        <MailCheck className="size-6" />
      </span>
      <h3 ref={headingRef} tabIndex={-1} className="mt-5 text-xl font-semibold tracking-tight outline-none">
        {t('signup.success.title')}
      </h3>
      <p className="mt-2 text-md text-muted">
        {richText(t('signup.success.body'), { email: <strong className="font-semibold break-all text-fg">{email}</strong> })}
      </p>
      <p className="mt-4 text-sm text-muted">{t('signup.success.hint')}</p>
      <Button variant="secondary" icon={RotateCcw} onClick={onAgain} className="mt-6" data-testid="signup-again">
        {t('signup.success.again')}
      </Button>
    </div>
  );
}
