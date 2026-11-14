import { ArrowRight, Snowflake } from 'lucide-react';
import { Link } from 'react-router';
import { useTreasury } from '../api/queries';
import { useI18n } from '../i18n';
import { DangerBanner } from './PaymentsSwitch';
import { buttonClasses } from './ui/Button';

/** App-wide notice while the treasury contract is paused on NEAR (only the owner wallet can resume it). */
export function TreasuryFrozenBanner() {
  const { t } = useI18n();
  const { data } = useTreasury();
  if (!data?.onChain?.paused) return null;
  return (
    <DangerBanner
      icon={Snowflake}
      title={t('frozen.bannerTitle')}
      body={t('frozen.bannerBody')}
      testId="treasury-frozen-banner"
      action={
        <Link to="/treasury" className={buttonClasses('primary', 'sm', 'shrink-0')} data-testid="treasury-frozen-banner-link">
          {t('frozen.bannerLink')}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      }
    />
  );
}
