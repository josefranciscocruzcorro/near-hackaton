import { internalActionToNaj } from '@near-wallet-selector/core';
import { describe, expect, it } from 'vitest';
import {
  buildOwnerTransaction,
  DEFAULT_GAS,
  isPopupBlocked,
  isWalletCancel,
  ONE_YOCTO,
  outcomeTxHash,
  parseWalletRedirect,
  WITHDRAW_GAS,
} from './ownerTx';

const TREASURY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9a';
const OWNER = 'test.near';

describe('owner transactions (treasury contract)', () => {
  it('withdraw: USDC base units to the owner, 1 yocto, 100 Tgas', () => {
    expect(buildOwnerTransaction(TREASURY, OWNER, { kind: 'withdraw', amountRaw: '10000000' })).toEqual({
      receiverId: TREASURY,
      actions: [
        {
          type: 'FunctionCall',
          params: { methodName: 'withdraw', args: { receiver_id: OWNER, amount: '10000000' }, gas: '100000000000000', deposit: '1' },
        },
      ],
    });
    expect(WITHDRAW_GAS).toBe('100000000000000');
    expect(ONE_YOCTO).toBe('1');
  });

  it('unpause: no arguments, 1 yocto, 30 Tgas', () => {
    expect(buildOwnerTransaction(TREASURY, OWNER, { kind: 'unpause' })).toEqual({
      receiverId: TREASURY,
      actions: [{ type: 'FunctionCall', params: { methodName: 'unpause', args: {}, gas: '30000000000000', deposit: '1' } }],
    });
    expect(DEFAULT_GAS).toBe('30000000000000');
  });

  it('set_limits: both limits in base units, 1 yocto, 30 Tgas', () => {
    const tx = buildOwnerTransaction(TREASURY, OWNER, { kind: 'setLimits', maxPerPaymentRaw: '75500000', dailyLimitRaw: '200000000' });
    expect(tx.actions[0].params).toEqual({
      methodName: 'set_limits',
      args: { max_per_payment: '75500000', daily_limit: '200000000' },
      gas: DEFAULT_GAS,
      deposit: ONE_YOCTO,
    });
  });

  it('refuses amounts that are not positive base-unit integers, and max above daily', () => {
    expect(() => buildOwnerTransaction(TREASURY, OWNER, { kind: 'withdraw', amountRaw: '0' })).toThrow();
    expect(() => buildOwnerTransaction(TREASURY, OWNER, { kind: 'withdraw', amountRaw: '1.5' })).toThrow();
    expect(() => buildOwnerTransaction(TREASURY, OWNER, { kind: 'setLimits', maxPerPaymentRaw: '300', dailyLimitRaw: '200' })).toThrow(/daily/);
  });

  it('maps 1:1 to the wallet-selector action the wallets sign', () => {
    const [action] = buildOwnerTransaction(TREASURY, OWNER, { kind: 'withdraw', amountRaw: '2500000' }).actions;
    const naj = internalActionToNaj(action);
    expect(naj.functionCall?.methodName).toBe('withdraw');
    expect(naj.functionCall?.gas).toBe(100000000000000n);
    expect(naj.functionCall?.deposit).toBe(1n);
    expect(JSON.parse(new TextDecoder().decode(naj.functionCall?.args))).toEqual({ receiver_id: OWNER, amount: '2500000' });
  });
});

describe('wallet results', () => {
  it('reads the MyNearWallet redirect', () => {
    expect(parseWalletRedirect('?transactionHashes=abc,def')).toEqual({ kind: 'success', txHashes: ['abc', 'def'] });
    expect(parseWalletRedirect('?errorCode=userRejected&errorMessage=User%20rejected')).toEqual({
      kind: 'failure',
      errorCode: 'userRejected',
      message: 'User rejected',
    });
    expect(parseWalletRedirect('?fund=1')).toBeNull();
  });

  it('tells a cancelled or blocked wallet window from a real failure', () => {
    expect(isWalletCancel(new Error('User closed the window'))).toBe(true);
    expect(isWalletCancel(new Error('User rejected the transaction'))).toBe(true);
    expect(isWalletCancel('CLOSED')).toBe(true);
    expect(isWalletCancel(new Error('Exceeded the prepaid gas'))).toBe(false);
    expect(isPopupBlocked(new Error('Popup window blocked. Please allow popups for this site.'))).toBe(true);
  });

  it('extracts the transaction hash from the outcome', () => {
    expect(outcomeTxHash({ transaction: { hash: 'H1' } })).toBe('H1');
    expect(outcomeTxHash({ transaction_outcome: { id: 'H2' } })).toBe('H2');
    expect(outcomeTxHash(undefined)).toBeNull();
  });
});
