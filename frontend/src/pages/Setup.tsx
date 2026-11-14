import { useQueryClient } from '@tanstack/react-query';
import { Building2, KeyRound, Rocket, ShieldCheck } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { queryKeys, useInstance } from '../api/queries';
import { MIN_PASSWORD_LENGTH } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { LanguageToggle, Logo, ThemeToggle } from '../components/layout/Chrome';
import { PasswordField } from '../components/PasswordField';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { useI18n, type TFunction } from '../i18n';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SetupForm {
  setupToken: string;
  organizationName: string;
  ownerName: string;
  email: string;
  password: string;
  confirm: string;
}

export type SetupErrors = Partial<Record<keyof SetupForm, string>>;

export function validateSetup(f: SetupForm, t: TFunction, tokenRequired = false): SetupErrors {
  const e: SetupErrors = {};
  if (tokenRequired && !f.setupToken.trim()) e.setupToken = t('setup.tokenRequired');
  if (!f.organizationName.trim()) e.organizationName = t('validation.nameRequired');
  else if (f.organizationName.trim().length > 120) e.organizationName = t('validation.tooLong', { max: 120 });
  if (!f.ownerName.trim()) e.ownerName = t('validation.nameRequired');
  else if (f.ownerName.trim().length > 120) e.ownerName = t('validation.tooLong', { max: 120 });
  if (!EMAIL.test(f.email.trim())) e.email = t('validation.email');
  if (f.password.length < MIN_PASSWORD_LENGTH) e.password = t('validation.passwordLength', { min: MIN_PASSWORD_LENGTH });
  if (f.confirm !== f.password) e.confirm = t('validation.passwordMismatch');
  return e;
}

/** First-run wizard: shown only while the server reports `needsSetup` (no users yet). */
export function SetupPage() {
  const { t } = useI18n();
  const { setup } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const instance = useInstance().data;
  const tokenRequired = instance?.setupTokenRequired ?? false;
  // Tenants created through the landing signup already know their name (ADR-0006).
  const knownOrganization = instance?.organizationName ?? null;
  const [form, setForm] = useState<SetupForm>({
    setupToken: params.get('token') ?? '',
    organizationName: knownOrganization ?? '',
    ownerName: '',
    email: '',
    password: '',
    confirm: '',
  });
  const [errors, setErrors] = useState<SetupErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = <K extends keyof SetupForm>(k: K, v: SetupForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError(null);
    const v = validateSetup(form, t, tokenRequired);
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    setPending(true);
    try {
      await setup({
        organizationName: form.organizationName.trim(),
        ownerName: form.ownerName.trim(),
        email: form.email.trim(),
        password: form.password,
        setupToken: form.setupToken.trim() || null,
      });
      void navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Someone completed the setup first: refresh the instance so the gate sends us to /login.
        setServerError(err.problem?.detail ?? t('setup.alreadyDone'));
        void queryClient.invalidateQueries({ queryKey: queryKeys.instance });
      } else if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setServerError(err.message);
      } else {
        setServerError(t('error.generic'));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="grid w-full max-w-4xl gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <section className="hidden lg:block">
            <p className="text-sm font-semibold text-accent-strong">{t('setup.kicker')}</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{t('setup.headline')}</h2>
            <p className="mt-3 text-md text-muted">{t('setup.pitch')}</p>
            <ul className="mt-6 space-y-3 text-sm">
              {(['setup.point1', 'setup.point2', 'setup.point3'] as const).map((k) => (
                <li key={k} className="flex items-start gap-2.5">
                  <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-strong" />
                  <span>{t(k)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[10px] border border-border bg-surface p-5 shadow-sm sm:p-6" aria-labelledby="setup-title">
            <h1 id="setup-title" className="flex items-center gap-2 text-lg font-semibold">
              <Building2 aria-hidden className="size-5 text-accent-strong" />
              {t('setup.title')}
            </h1>
            <p className="mt-1 text-sm text-muted">{t('setup.subtitle')}</p>

            <form onSubmit={(e) => void onSubmit(e)} noValidate className="mt-5 space-y-4" data-testid="setup-form">
              {tokenRequired ? (
                <TextField
                  label={t('setup.token')}
                  hint={t('setup.tokenHint')}
                  required
                  value={form.setupToken}
                  error={errors.setupToken}
                  onChange={(e) => set('setupToken', e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  data-testid="setup-token"
                />
              ) : null}
              <TextField
                label={t('setup.orgName')}
                required
                value={form.organizationName}
                error={errors.organizationName}
                onChange={(e) => set('organizationName', e.target.value)}
                autoComplete="organization"
                data-testid="setup-org"
              />
              <TextField
                label={t('setup.ownerName')}
                required
                value={form.ownerName}
                error={errors.ownerName}
                onChange={(e) => set('ownerName', e.target.value)}
                autoComplete="name"
                data-testid="setup-name"
              />
              <TextField
                label={t('login.email')}
                hint={knownOrganization ? t('setup.emailHint') : undefined}
                type="email"
                inputMode="email"
                required
                value={form.email}
                error={errors.email}
                onChange={(e) => set('email', e.target.value)}
                autoComplete="username"
                data-testid="setup-email"
              />
              <PasswordField
                label={t('login.password')}
                required
                showStrength
                value={form.password}
                onValueChange={(v) => set('password', v)}
                error={errors.password}
                autoComplete="new-password"
                testId="setup-password"
              />
              <PasswordField
                label={t('password.confirm')}
                required
                value={form.confirm}
                onValueChange={(v) => set('confirm', v)}
                error={errors.confirm}
                autoComplete="new-password"
                testId="setup-confirm"
              />
              {serverError ? (
                <p role="alert" data-testid="setup-error" className="flex items-start gap-2 text-sm font-medium text-danger">
                  <KeyRound aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {serverError}
                </p>
              ) : null}
              <Button type="submit" variant="primary" icon={Rocket} loading={pending} className="w-full" data-testid="setup-submit">
                {t('setup.submit')}
              </Button>
            </form>
            <p className="mt-4 text-xs text-muted">{t('setup.footnote')}</p>
          </section>
        </div>
      </main>
    </div>
  );
}
