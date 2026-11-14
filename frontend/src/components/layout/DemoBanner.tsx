import { FlaskConical, X } from 'lucide-react';
import { useState } from 'react';
import { useIsDemo } from '../../api/queries';
import { useI18n } from '../../i18n';

const DISMISS_KEY = 'tesorero.demoBanner.dismissed';

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Thin notice shown on the public demo instance; dismissible for the browser session. */
export function DemoBanner() {
  const { t } = useI18n();
  const demo = useIsDemo();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!demo || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore: it stays hidden until reload
    }
  };

  return (
    <div
      role="note"
      data-testid="demo-banner"
      className="flex items-center gap-2 border-b border-info/30 bg-info-soft px-4 py-1.5 text-xs text-info sm:text-sm lg:px-6"
    >
      <FlaskConical aria-hidden className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">{t('demo.banner')}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('demo.dismiss')}
        data-testid="demo-banner-dismiss"
        className="-my-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-info/10 pointer-fine:size-7"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
