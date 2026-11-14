import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useI18n } from '../i18n';
import { useToast } from './ui/Toast';

const UPDATED_FLAG = 'tesorero.sw-updated';
/** "Ready to work offline" is said once per device, ever. */
export const OFFLINE_SHOWN_KEY = 'tesorero.offlineReady.shown';

/** True the first time only (and when storage is unavailable, never: better silent than repeated). */
export function firstOfflineReady(): boolean {
  try {
    if (localStorage.getItem(OFFLINE_SHOWN_KEY) === '1') return false;
    localStorage.setItem(OFFLINE_SHOWN_KEY, '1');
    return true;
  } catch {
    return false;
  }
}
const UPDATE_POLL_MS = 60_000;

function markUpdated() {
  try {
    sessionStorage.setItem(UPDATED_FLAG, '1');
  } catch {
    // ignore
  }
}

/**
 * Service worker lifecycle (registerType: 'autoUpdate'): checks for a new build every 60 s, the new
 * worker activates immediately and the page reloads; after reload we announce "New version installed".
 */
export function PwaUpdater() {
  const { toast } = useToast();
  const { t } = useI18n();
  // The service worker callbacks are registered once: read the current language through a ref.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // A new worker installing while this page is already controlled = an update (not first install).
      registration.addEventListener('updatefound', () => {
        if (navigator.serviceWorker.controller) markUpdated();
      });
      window.setInterval(() => {
        if (registration.installing || !navigator.onLine) return;
        registration.update().catch(() => undefined);
      }, UPDATE_POLL_MS);
    },
    onOfflineReady() {
      if (firstOfflineReady()) toast({ title: tRef.current('pwa.offlineReady'), description: tRef.current('pwa.offlineReadyBody'), tone: 'info', duration: 5000 });
    },
  });

  useEffect(() => {
    let updated = false;
    try {
      updated = sessionStorage.getItem(UPDATED_FLAG) === '1';
      sessionStorage.removeItem(UPDATED_FLAG);
    } catch {
      updated = false;
    }
    if (updated) toast({ title: t('pwa.updated'), description: t('pwa.updatedBody'), tone: 'success', duration: 7000 });
  }, [toast, t]);

  return null;
}
