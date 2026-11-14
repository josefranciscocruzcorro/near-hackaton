import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { buttonClasses } from '../components/ui/Button';
import { EmptyState } from '../components/ui/States';
import { useI18n } from '../i18n';

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={Compass}
      title={t('notFound.title')}
      description={t('notFound.body')}
      action={
        <Link to="/" className={buttonClasses('primary')}>
          {t('notFound.home')}
        </Link>
      }
    />
  );
}
