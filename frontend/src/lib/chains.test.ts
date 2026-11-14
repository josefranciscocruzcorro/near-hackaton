import { describe, expect, it } from 'vitest';
import type { Token } from '../api/types';
import { chainName, isDeprecated, isStablecoin, recommendedTokens } from './chains';

const tk = (symbol: string, blockchain: string, assetId: string, priceUsd = 1): Token => ({ symbol, blockchain, assetId, decimals: 6, priceUsd });

describe('chains', () => {
  it('uses the names people see in exchanges', () => {
    expect(chainName('bsc')).toBe('BNB Smart Chain (BEP20)');
    expect(chainName('eth')).toBe('Ethereum (ERC20)');
    expect(chainName('tron')).toBe('Tron (TRC20)');
    expect(chainName('arb')).toBe('Arbitrum One');
    expect(chainName('near')).toBe('NEAR');
    expect(chainName('newchain')).toBe('NEWCHAIN');
  });

  it('recommends the canonical token, in order, ignoring look-alikes and deprecated ones', () => {
    const bridged = tk('USDC', 'base', 'nep141:base-0x9999999999999999999999999999999999999999.omft.near');
    const canonical = tk('USDC', 'base', 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near');
    const tron = tk('USDT', 'tron', 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near');
    const near = tk('USDC', 'near', 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1');
    const old = tk('USDC', 'sol', 'nep141:sol-deprecated.omft.near');
    expect(recommendedTokens([tron, bridged, near, canonical, old])).toEqual([canonical, near, tron]);
  });

  it('detects dollar stablecoins and deprecated tokens', () => {
    expect(isStablecoin(tk('USDT', 'tron', 'x'))).toBe(true);
    expect(isStablecoin(tk('DAI', 'eth', 'x', 0.999))).toBe(true);
    expect(isStablecoin(tk('ETH', 'eth', 'x', 3200))).toBe(false);
    expect(isStablecoin(tk('sUSDC', 'base', 'x', 1.12))).toBe(false);
    expect(isDeprecated(tk('USDC (DEPRECATED)', 'base', 'x'))).toBe(true);
  });
});
