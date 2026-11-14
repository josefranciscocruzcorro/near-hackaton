import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError } from './api/client';
import { useInstance } from './api/queries';
import { AuthProvider } from './auth/AuthContext';
import { PwaUpdater } from './components/PwaUpdater';
import { ToastProvider } from './components/ui/Toast';
import { I18nProvider, useI18n } from './i18n';
import { ThemeProvider } from './lib/theme';
import { AppRouter } from './router';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        // Never retry auth/permission/validation failures; retry transient errors once.
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
      },
      mutations: { retry: false },
    },
  });
}

const queryClient = createQueryClient();

/** Uses the organization's signup language until the person picks one with the toggle. */
export function InstanceLanguage() {
  const { applyDefaultLang } = useI18n();
  const language = useInstance().data?.language;
  useEffect(() => {
    if (language === 'en' || language === 'es') applyDefaultLang(language);
  }, [language, applyDefaultLang]);
  return null;
}

function Localized() {
  const { t } = useI18n();
  return (
    <ToastProvider dismissLabel={t('common.dismiss')}>
      <AuthProvider>
        <InstanceLanguage />
        <PwaUpdater />
        <AppRouter />
      </AuthProvider>
    </ToastProvider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <Localized />
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
