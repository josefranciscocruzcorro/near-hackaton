import { describe, expect, it } from 'vitest';
import type { Token } from '../api/types';
import { rankTokens, shortContract } from './Payees';

const tk = (symbol: string, blockchain: string, assetId: string): Token => ({ symbol, blockchain, assetId, decimals: 6, priceUsd: 1 });
const USDC_BASE = tk('USDC', 'base', 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near');
const SUSDC_BASE = tk('sUSDC', 'base', 'nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near');
const SPARK = tk('sparkUSDC', 'base', 'nep141:base-0x1111111111111111111111111111111111111111.omft.near');
const USDC_NEAR = tk('USDC', 'near', 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1');
const SOL = tk('SOL', 'sol', 'nep141:sol.omft.near');

describe('token picker', () => {
  it('shows a short contract id so look-alike tokens can be told apart', () => {
    expect(shortContract(USDC_BASE.assetId)).toBe('0x8335…2913');
    expect(shortContract(USDC_NEAR.assetId)).toBe('172086…33a1');
    expect(shortContract(SOL.assetId)).toBe('sol');
  });

  it('ranks exact symbol matches before look-alikes', () => {
    expect(rankTokens([SPARK, SUSDC_BASE, USDC_BASE, USDC_NEAR], 'usdc base').map((t) => t.symbol)).toEqual(['USDC', 'sparkUSDC', 'sUSDC']);
    expect(rankTokens([SUSDC_BASE, USDC_BASE, SOL], 'usdc')[0]).toBe(USDC_BASE);
    expect(rankTokens([SOL, USDC_BASE], '')).toHaveLength(2);
  });
});
