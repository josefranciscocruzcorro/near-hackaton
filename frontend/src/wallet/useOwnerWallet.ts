import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { useTheme } from '../lib/theme';
import type { OwnerTransaction } from '../lib/ownerTx';
import type { OwnerWalletHandle } from './selector';

/** Wallet selector remembers the last wallet here; only then do we load the SDKs on page load. */
const REMEMBERED_KEY = 'near-wallet-selector:selectedWalletId';

function hasRememberedWallet(): boolean {
  try {
    const v = localStorage.getItem(REMEMBERED_KEY);
    return v !== null && v !== 'null';
  } catch {
    return false;
  }
}

export type WalletStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface OwnerWallet {
  status: WalletStatus;
  /** Signed-in account, or null. */
  accountId: string | null;
  /** Opens the wallet picker (loads the SDKs the first time). */
  connect: () => Promise<void>;
  /** Signs out and opens the picker again so another account can be chosen. */
  switchAccount: () => Promise<void>;
  disconnect: () => Promise<void>;
  send: (tx: OwnerTransaction) => Promise<string | null>;
  error: Error | null;
}

/**
 * NEAR Wallet Selector for the owner's actions. The SDKs live in their own chunk
 * (`./selector`), fetched the first time the owner asks to sign — or right away when a wallet was
 * already connected on this device, to show which account it is.
 */
export function useOwnerWallet(): OwnerWallet {
  const { lang, t } = useI18n();
  const { resolved } = useTheme();
  const [status, setStatus] = useState<WalletStatus>('idle');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const handle = useRef<OwnerWalletHandle | null>(null);
  const loading = useRef<Promise<OwnerWalletHandle> | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const options = useRef({ language: lang, theme: resolved, description: t('wallet.modalDescription') });
  useEffect(() => {
    options.current = { language: lang, theme: resolved, description: t('wallet.modalDescription') };
  }, [lang, resolved, t]);

  const load = useCallback(async (): Promise<OwnerWalletHandle> => {
    if (handle.current) return handle.current;
    if (!loading.current) {
      setStatus('loading');
      loading.current = import('./selector')
        .then((m) => m.loadOwnerWallet(options.current))
        .then((h) => {
          handle.current = h;
          setAccountId(h.accountId());
          unsubscribe.current = h.subscribe(setAccountId);
          setStatus('ready');
          setError(null);
          return h;
        })
        .catch((err: unknown) => {
          loading.current = null;
          setStatus('error');
          const e = err instanceof Error ? err : new Error(String(err));
          setError(e);
          throw e;
        });
    }
    return loading.current;
  }, []);

  useEffect(() => {
    if (hasRememberedWallet()) load().catch(() => undefined);
    return () => unsubscribe.current?.();
  }, [load]);

  const connect = useCallback(async () => {
    const h = await load();
    h.show();
  }, [load]);

  const disconnect = useCallback(async () => {
    const h = await load();
    await h.signOut();
    setAccountId(h.accountId());
  }, [load]);

  const switchAccount = useCallback(async () => {
    const h = await load();
    await h.signOut();
    setAccountId(h.accountId());
    h.show();
  }, [load]);

  const send = useCallback(
    async (tx: OwnerTransaction) => {
      const h = await load();
      return h.send(tx);
    },
    [load],
  );

  return { status, accountId, connect, switchAccount, disconnect, send, error };
}
