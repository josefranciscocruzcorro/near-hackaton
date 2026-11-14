// Transactions the owner wallet signs on the treasury contract (ADR-0007 §5). Pure data: the wallet
// chunk (src/wallet/selector.ts) turns them into wallet-selector actions. Unit-tested.

/** 1 yoctoNEAR: the contract requires it so only a full-access key (a real wallet) can call. */
export const ONE_YOCTO = '1';
/** `withdraw` makes a cross-contract USDC transfer and its callback: 100 Tgas. */
export const WITHDRAW_GAS = '100000000000000';
/** `unpause` and `set_limits` only touch the contract's own state: 30 Tgas. */
export const DEFAULT_GAS = '30000000000000';

export type OwnerAction =
  | { kind: 'withdraw'; /** USDC base units (6 decimals) */ amountRaw: string }
  | { kind: 'unpause' }
  | { kind: 'setLimits'; /** USDC base units */ maxPerPaymentRaw: string; dailyLimitRaw: string };

export type OwnerActionKind = OwnerAction['kind'];

/** Same shape as wallet-selector's internal `FunctionCall` action, so it maps 1:1. */
export interface FunctionCallAction {
  type: 'FunctionCall';
  params: { methodName: string; args: Record<string, string>; gas: string; deposit: string };
}

export interface OwnerTransaction {
  receiverId: string;
  actions: [FunctionCallAction];
}

const isBaseUnits = (raw: string) => /^[1-9]\d*$/.test(raw);

const call = (treasury: string, methodName: string, args: Record<string, string>, gas: string): OwnerTransaction => ({
  receiverId: treasury,
  actions: [{ type: 'FunctionCall', params: { methodName, args, gas, deposit: ONE_YOCTO } }],
});

/**
 * Builds the transaction for an owner action. `owner` is the wallet that receives a withdrawal (the
 * contract only lets its owner call these methods, so it is always the signer too).
 * Throws on amounts that are not positive base-unit integers or limits where max > daily.
 */
export function buildOwnerTransaction(treasury: string, owner: string, action: OwnerAction): OwnerTransaction {
  switch (action.kind) {
    case 'withdraw':
      if (!isBaseUnits(action.amountRaw)) throw new Error('Withdraw amount must be a positive integer in base units.');
      return call(treasury, 'withdraw', { receiver_id: owner, amount: action.amountRaw }, WITHDRAW_GAS);
    case 'unpause':
      return call(treasury, 'unpause', {}, DEFAULT_GAS);
    case 'setLimits': {
      const { maxPerPaymentRaw: max, dailyLimitRaw: daily } = action;
      if (!isBaseUnits(max) || !isBaseUnits(daily)) throw new Error('Limits must be positive integers in base units.');
      if (BigInt(max) > BigInt(daily)) throw new Error('The max per payment cannot exceed the daily limit.');
      return call(treasury, 'set_limits', { max_per_payment: max, daily_limit: daily }, DEFAULT_GAS);
    }
  }
}

// ---------- MyNearWallet comes back to the page with the result in the URL ----------

export type WalletRedirect = { kind: 'success'; txHashes: string[] } | { kind: 'failure'; errorCode: string; message: string | null } | null;

/** Reads `?transactionHashes=a,b` / `?errorCode=userRejected&errorMessage=…` left by the wallet. */
export function parseWalletRedirect(search: string): WalletRedirect {
  const params = new URLSearchParams(search);
  const hashes = params.get('transactionHashes');
  if (hashes) {
    const list = hashes.split(',').map((h) => h.trim()).filter(Boolean);
    if (list.length > 0) return { kind: 'success', txHashes: list };
  }
  const errorCode = params.get('errorCode');
  if (errorCode) return { kind: 'failure', errorCode, message: params.get('errorMessage') };
  return null;
}

export const WALLET_REDIRECT_PARAMS = ['transactionHashes', 'errorCode', 'errorMessage', 'account_id', 'public_key', 'all_keys'] as const;

/** A wallet error that only means "the person closed or rejected it": nothing was sent. */
export function isWalletCancel(error: unknown): boolean {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /user ?(closed|rejected|cancel)|rejected by user|cancel+ed|^closed$|userRejected/i.test(text);
}

export function isPopupBlocked(error: unknown): boolean {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /popup.*blocked|blocked.*popup/i.test(text);
}

/** Pulls the transaction hash out of what `signAndSendTransaction` returns (FinalExecutionOutcome). */
export function outcomeTxHash(outcome: unknown): string | null {
  if (!outcome || typeof outcome !== 'object') return null;
  const tx = (outcome as { transaction?: { hash?: unknown }; transaction_outcome?: { id?: unknown } }).transaction;
  if (tx && typeof tx.hash === 'string') return tx.hash;
  const id = (outcome as { transaction_outcome?: { id?: unknown } }).transaction_outcome?.id;
  return typeof id === 'string' ? id : null;
}
