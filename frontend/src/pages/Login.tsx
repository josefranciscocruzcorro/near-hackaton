import { Eye, FileSearch, KeyRound, LogIn, ShieldCheck, UserCog } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { useInstance } from '../api/queries';
import type { Role } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { LanguageToggle, Logo, ThemeToggle } from '../components/layout/Chrome';
import { Button } from '../components/ui/Button';
import { TextField } from '../components/ui/Field';
import { useI18n } from '../i18n';

/** Seeded demo accounts (docs/api/CONTRACT.md — demo environment only). */
export const DEMO_PASSWORD = 'Demo!2026';
export const DEMO_ACCOUNTS: { role: Role; email: string; icon: typeof UserCog }[] = [
  { role: 'Owner', email: 'owner@tesorero.demo', icon: UserCog },
  { role: 'Approver', email: 'approver@tesorero.demo', icon: ShieldCheck },
  { role: 'Auditor', email: 'auditor@tesorero.demo', icon: FileSearch },
];

export function LoginPage() {
  const { t } = useI18n();
  const { login, isAuthenticated, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const instance = useInstance().data;
  // Demo shortcuts only when the server explicitly says this is the public demo instance.
  const demo = instance?.demo === true;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  if (isAuthenticated && pending === null) return <Navigate to={from} replace />;

  const submit = async (creds: { email: string; password: string }, key: string) => {
    setError(null);
    setPending(key);
    try {
      await login(creds);
      void navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t('login.invalid') : err instanceof Error ? err.message : t('error.generic'));
    } finally {
      setPending(null);
    }
  };

  const onSubmit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError(t('login.required'));
      return;
    }
    void submit({ email: email.trim(), password }, 'form');
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
        <div className="grid w-full max-w-4xl gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <section className="hidden lg:block">
            <p className="text-sm font-semibold text-accent-strong">{t('login.kicker')}</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">{t('login.headline')}</h2>
            <p className="mt-3 text-md text-muted">{t('login.pitch')}</p>
            <ul className="mt-6 space-y-3 text-sm">
              {(['login.point1', 'login.point2', 'login.point3'] as const).map((k) => (
                <li key={k} className="flex items-start gap-2.5">
                  <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-strong" />
                  <span>{t(k)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[10px] border border-border bg-surface p-5 shadow-sm sm:p-6" aria-labelledby="login-title">
            {!demo && instance?.organizationName ? (
              <div className="mb-4 border-b border-border pb-4" data-testid="login-tenant">
                {instance.tenantSlug ? (
                  <p className="num text-xs text-muted">{t('login.tenantContext', { slug: instance.tenantSlug })}</p>
                ) : null}
                <p className="mt-0.5 truncate text-md font-semibold" data-testid="login-org-name">
                  {instance.organizationName}
                </p>
              </div>
            ) : null}
            <h1 id="login-title" className="text-lg font-semibold">
              {t('login.title')}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {demo
                ? t('login.subtitle')
                : instance?.organizationName
                  ? t('login.subtitleOrg', { org: instance.organizationName })
                  : t('login.subtitleReal')}
            </p>

            {sessionExpired ? (
              <p role="status" className="mt-4 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
                {t('login.expired')}
              </p>
            ) : null}

            {demo ? (
              <>
                <div className="mt-5">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{t('login.demoTitle')}</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {DEMO_ACCOUNTS.map((acc) => {
                      const Icon = acc.icon;
                      return (
                        <button
                          key={acc.role}
                          type="button"
                          data-testid={`demo-login-${acc.role.toLowerCase()}`}
                          disabled={pending !== null}
                          aria-busy={pending === acc.role || undefined}
                          onClick={() => void submit({ email: acc.email, password: DEMO_PASSWORD }, acc.role)}
                          className="flex min-h-11 flex-col items-start gap-0.5 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-accent hover:bg-accent-soft disabled:opacity-60"
                        >
                          <span className="flex items-center gap-1.5 text-sm font-semibold">
                            <Icon aria-hidden className="size-4 text-accent-strong" />
                            {t(`role.${acc.role}`)}
                          </span>
                          <span className="text-xs text-muted">{t(`role.${acc.role}.short`)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-muted">{t('login.demoHint')}</p>
                </div>

                <div className="my-5 flex items-center gap-3 text-xs text-muted">
                  <span className="h-px flex-1 bg-border" />
                  {t('login.or')}
                  <span className="h-px flex-1 bg-border" />
                </div>
              </>
            ) : null}

            <form onSubmit={onSubmit} noValidate className={demo ? 'space-y-4' : 'mt-5 space-y-4'}>
              <TextField
                label={t('login.email')}
                type="email"
                autoComplete="username"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="login-email"
              />
              <TextField
                label={t('login.password')}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="login-password"
              />
              {error ? (
                <p role="alert" data-testid="login-error" className="flex items-center gap-2 text-sm font-medium text-danger">
                  <KeyRound aria-hidden className="size-4" />
                  {error}
                </p>
              ) : null}
              <Button type="submit" variant="primary" icon={LogIn} loading={pending === 'form'} disabled={pending !== null} className="w-full" data-testid="login-submit">
                {t('login.submit')}
              </Button>
            </form>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
              <Eye aria-hidden className="size-3.5" />
              {t('login.privacy')}
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
