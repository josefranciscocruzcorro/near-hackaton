import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { clearPreservingInstance, PAYMENTS_POLL_MS, paymentsRefetchInterval, queryKeys } from './queries';

describe('payments list freshness', () => {
  it('polls while any payment is still moving (approved, awaiting deposit, processing)', () => {
    expect(paymentsRefetchInterval([{ status: 'Settled' }, { status: 'Approved' }])).toBe(PAYMENTS_POLL_MS);
    expect(paymentsRefetchInterval([{ status: 'Processing' }])).toBe(PAYMENTS_POLL_MS);
    expect(paymentsRefetchInterval([{ status: 'AwaitingDeposit' }])).toBe(PAYMENTS_POLL_MS);
  });

  it('stops polling once every payment is final', () => {
    expect(paymentsRefetchInterval([{ status: 'Settled' }, { status: 'Rejected' }, { status: 'Blocked' }, { status: 'Failed' }])).toBe(false);
    expect(paymentsRefetchInterval([])).toBe(false);
    expect(paymentsRefetchInterval(undefined)).toBe(false);
  });
});

describe('clearing the cache on sign-in/out', () => {
  it('drops private data but keeps the instance info', () => {
    const qc = new QueryClient();
    qc.setQueryData(queryKeys.instance, { kind: 'tenant' });
    qc.setQueryData(['payments'], [{ id: 1 }]);
    clearPreservingInstance(qc);
    expect(qc.getQueryData(queryKeys.instance)).toEqual({ kind: 'tenant' });
    expect(qc.getQueryData(['payments'])).toBeUndefined();
  });

  // Regression: a 401 from /me landing before /api/instance resolved left the app on a spinner.
  it('keeps an instance lookup that is still in flight so the router gate still resolves', async () => {
    const qc = new QueryClient();
    let resolve!: (v: unknown) => void;
    const observer = new QueryObserver(qc, { queryKey: queryKeys.instance, queryFn: () => new Promise((r) => (resolve = r)) });
    const seen: unknown[] = [];
    const unsubscribe = observer.subscribe((r) => seen.push(r.data));

    clearPreservingInstance(qc);
    resolve({ kind: 'tenant' });

    await expect.poll(() => seen.at(-1)).toEqual({ kind: 'tenant' });
    expect(observer.getCurrentResult().isPending).toBe(false);
    unsubscribe();
  });
});
