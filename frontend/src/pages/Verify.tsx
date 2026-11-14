import { ArrowLeft, ArrowUpRight, CircleCheck, Loader2, MailWarning, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { VerifySignupResponse } from '../api/types';
import { LanguageToggle, Logo, ThemeToggle } from '../components/layout/Chrome';
import { Button, buttonClasses } from '../components/ui/Button';
import { useI18n } from '../i18n';
import { richText } from '../i18n/rich';

type VerifyState =
  | { status: 'loading' }
  | { status: 'success'; data: VerifySignupResponse }
  | { status: 'error'; reason: 'missing' | 'invalid' | 'conflict' | 'generic'; detail?: string };

function toErrorState(err: unknown): VerifyState {
  if (err instanceof ApiError && err.status === 400) return { status: 'error', reason: 'invalid' };
  if (err instanceof ApiError && err.status === 409) {
    return { status: 'error', reason: 'conflict', detail: err.problem?.detail ?? err.message };
  }
  return { status: 'error', reason: 'generic' };
}

function hostOf(url: string, fallback: string): string {
  try {
    return new URL(url).host;
  } catch {
    return fallback;
  }
}

/** Apex `/verify?token=…`: confirms the signup email once and points to the new tenant. */
export function VerifyPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token')?.trim() ?? '';
  const [state, setState] = useState<VerifyState>(() => (token ? { status: 'loading' } : { status: 'error', reason: 'missing' }));
  const [attempt, setAttempt] = useState(0);
  // The token is single-use: StrictMode re-runs effects, so remember which attempt already went out.
  const sent = useRef<string | null>(null);

  useEffect(() => {
    document.title = `${t('verify.title')} · Tesorero`;
  }, [t]);

  useEffect(() => {
    if (!token) return;
    const key = `${String(attempt)}:${token}`;
    if (sent.current === key) return;
    sent.current = key;
    endpoints.verifySignup(token).then(
      (data) => setState({ status: 'success', data }),
      (err: unknown) => setState(toErrorState(err)),
    );
  }, [token, attempt]);

  const retry = () => {
    setState({ status: 'loading' });
    setAttempt((a) => a + 1);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <Link to="/" className="rounded-lg">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <section className="w-full max-w-lg rounded-[10px] border border-border bg-surface p-6 shadow-sm sm:p-8" aria-labelledby="verify-title" aria-busy={state.status === 'loading'}>
          {state.status === 'loading' ? (
            <div role="status" className="flex flex-col items-center gap-4 py-6 text-center">
              <Loader2 aria-hidden className="size-8 animate-spin text-accent-strong" />
              <h1 id="verify-title" className="text-md font-medium">
                {t('verify.checking')}
              </h1>
            </div>
          ) : state.status === 'success' ? (
            <VerifySuccess data={state.data} />
          ) : (
            <VerifyError reason={state.reason} detail={state.detail} onRetry={retry} />
          )}
        </section>
      </main>
    </div>
  );
}

function VerifySuccess({ data }: { data: VerifySignupResponse }) {
  const { t } = useI18n();
  const host = hostOf(data.tenantUrl, data.slug);
  return (
    <div data-testid="verify-success">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
        <CircleCheck className="size-6" />
      </span>
      <h1 id="verify-title" className="mt-5 text-xl font-semibold tracking-tight">
        {t('verify.success.title')}
      </h1>
      <p className="mt-3 text-md text-muted">
        {richText(t('verify.success.body'), {
          org: <strong className="font-semibold text-fg">{data.organizationName}</strong>,
          url: <span className="num break-all text-fg">{data.tenantUrl}</span>,
          email: <strong className="font-semibold break-all text-fg">{data.email}</strong>,
        })}
      </p>
      <a href={data.tenantUrl} className={buttonClasses('primary', 'md', 'mt-6 w-full')} data-testid="verify-tenant-link">
        <span className="truncate">{t('verify.success.go', { host })}</span>
        <ArrowUpRight aria-hidden className="size-4" />
      </a>
      <p className="mt-3 text-center text-xs text-muted">{t('verify.success.note')}</p>
    </div>
  );
}

function VerifyError({ reason, detail, onRetry }: { reason: 'missing' | 'invalid' | 'conflict' | 'generic'; detail?: string; onRetry: () => void }) {
  const { t } = useI18n();
  const message =
    reason === 'missing'
      ? t('verify.error.missing')
      : reason === 'invalid'
        ? t('verify.error.invalid')
        : reason === 'conflict'
          ? (detail ?? t('error.generic'))
          : t('verify.error.generic');
  return (
    <div data-testid="verify-error" data-reason={reason} role="alert">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning">
        <MailWarning className="size-6" />
      </span>
      <h1 id="verify-title" className="mt-5 text-xl font-semibold tracking-tight">
        {reason === 'conflict' ? t('verify.error.conflictTitle') : t('verify.error.title')}
      </h1>
      <p className="mt-3 text-md text-muted">{message}</p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        {reason === 'generic' ? (
          <Button variant="primary" icon={RotateCcw} onClick={onRetry} data-testid="verify-retry">
            {t('common.retry')}
          </Button>
        ) : null}
        <Link to={{ pathname: '/', hash: '#signup' }} className={buttonClasses(reason === 'generic' ? 'secondary' : 'primary', 'md')} data-testid="verify-back">
          <ArrowLeft aria-hidden className="size-4" />
          {t('verify.backToSignup')}
        </Link>
      </div>
    </div>
  );
}
