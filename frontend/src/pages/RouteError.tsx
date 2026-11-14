import { TriangleAlert } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/States';
import { useI18n } from '../i18n';

/** Friendly fallback for render errors inside a page, instead of React Router's raw error screen. */
export function RouteErrorPage() {
  const { t } = useI18n();
  return (
    <div role="alert">
      <EmptyState
        icon={TriangleAlert}
        title={t('error.title')}
        description={t('error.page')}
        action={
          <Button
            variant="primary"
            onClick={() => {
              window.location.reload();
            }}
          >
            {t('error.reload')}
          </Button>
        }
      />
    </div>
  );
}
