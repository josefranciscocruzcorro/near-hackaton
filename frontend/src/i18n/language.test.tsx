import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { setRequestLanguage } from '../api/client';
import { endpoints } from '../api/endpoints';
import { InstanceLanguage } from '../App';
import { firstOfflineReady, OFFLINE_SHOWN_KEY } from '../components/PwaUpdater';
import { parseAmount } from '../pages/bills/billForm';
import { formatNumber, formatRelative } from '../lib/format';
import { instanceHandler } from '../test/fixtures';
import { server } from '../test/server';
import { renderWithProviders } from '../test/utils';
import { browserLang, translate, useI18n } from './index';

function LangProbe() {
  const { lang, t } = useI18n();
  return (
    <p data-testid="probe" data-lang={lang}>
      {t('setup.submit')}
    </p>
  );
}

afterEach(() => setRequestLanguage(null));

describe('language', () => {
  it('sends the UI language as Accept-Language on every request', async () => {
    let header: string | null = null;
    server.use(
      http.get('*/api/version', ({ request }) => {
        header = request.headers.get('accept-language');
        return HttpResponse.json({ version: '1', commit: 'abc', builtAt: '2026-11-14T00:00:00Z' });
      }),
    );
    setRequestLanguage('es');
    await endpoints.version();
    expect(header).toBe('es');
  });

  it('the provider keeps Accept-Language in sync with the UI language', async () => {
    let header: string | null = null;
    server.use(
      http.get('*/api/version', ({ request }) => {
        header = request.headers.get('accept-language');
        return HttpResponse.json({ version: '1', commit: 'abc', builtAt: '2026-11-14T00:00:00Z' });
      }),
    );
    renderWithProviders(<LangProbe />, { lang: 'es', withAuth: false });
    await endpoints.version();
    expect(header).toBe('es');
  });

  it('maps the browser language: any Spanish → es, anything else → en', () => {
    expect(browserLang(['es-EC', 'en'])).toBe('es');
    expect(browserLang(['ES'])).toBe('es');
    expect(browserLang(['pt-BR', 'es'])).toBe('en');
    expect(browserLang([])).toBe('en');
  });

  it('uses the organization language when the person has not chosen one', async () => {
    server.use(instanceHandler({ language: 'es' }));
    // No initialLang and nothing stored: the browser (en in jsdom) first, then the organization.
    renderWithProviders(
      <>
        <InstanceLanguage />
        <LangProbe />
      </>,
      { withAuth: false, lang: null },
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveAttribute('data-lang', 'es'));
    expect(screen.getByTestId('probe')).toHaveTextContent('Crear mi cuenta');
  });

  it('a stored choice wins over the organization language', async () => {
    localStorage.setItem('tesorero.lang', 'en');
    server.use(instanceHandler({ language: 'es' }));
    renderWithProviders(
      <>
        <InstanceLanguage />
        <LangProbe />
      </>,
      { withAuth: false, lang: null },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('probe')).toHaveAttribute('data-lang', 'en');
    expect(screen.getByTestId('probe')).toHaveTextContent('Create my account');
  });

  it('says "Create my account" on the setup button in both languages', () => {
    expect(translate('en', 'setup.submit')).toBe('Create my account');
    expect(translate('es', 'setup.submit')).toBe('Crear mi cuenta');
  });
});

describe('numbers and times in Spanish', () => {
  it('formats decimals with the locale', () => {
    expect(formatNumber(2.5, 'es-EC', 1)).toBe('2,5');
    expect(translate('es', 'treasury.setup.step2')).toBe('Envía 2,5 NEAR');
    expect(translate('es', 'treasury.check.agentGas.fix')).toContain('0,5 NEAR');
  });

  it('reads "just now" for times a moment ago or less than a minute ahead', () => {
    const now = Date.parse('2026-11-14T12:00:00Z');
    expect(formatRelative('2026-11-14T12:00:30Z', now)).toBe('just now');
    expect(formatRelative('2026-11-14T12:00:30Z', now, 'es-EC')).toBe('justo ahora');
    expect(formatRelative('2026-11-14T11:59:55Z', now)).toBe('just now');
    expect(formatRelative('2026-11-14T12:05:00Z', now)).toBe('in 5 minutes');
  });

  it('accepts the Spanish decimal comma in bill amounts', () => {
    expect(parseAmount('1250,50')).toBe(1250.5);
    expect(parseAmount('1,250.50')).toBe(1250.5);
  });
});

describe('offline-ready notice', () => {
  it('is shown once per device', () => {
    expect(firstOfflineReady()).toBe(true);
    expect(localStorage.getItem(OFFLINE_SHOWN_KEY)).toBe('1');
    expect(firstOfflineReady()).toBe(false);
  });
});
