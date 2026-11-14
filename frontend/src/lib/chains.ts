// Human names for the chain codes NEAR Intents uses, and the supplier token picker's rules.
import type { Token } from '../api/types';

/** Names people see in exchanges (Binance shows "BNB Smart Chain (BEP20)", "Tron (TRC20)"…). */
const CHAIN_NAMES: Record<string, string> = {
  near: 'NEAR',
  eth: 'Ethereum (ERC20)',
  base: 'Base',
  arb: 'Arbitrum One',
  pol: 'Polygon',
  sol: 'Solana',
  bsc: 'BNB Smart Chain (BEP20)',
  tron: 'Tron (TRC20)',
  op: 'Optimism',
  avax: 'Avalanche C-Chain',
  gnosis: 'Gnosis',
  btc: 'Bitcoin',
  ton: 'TON',
  sui: 'Sui',
  aptos: 'Aptos',
  xrp: 'XRP Ledger',
  stellar: 'Stellar',
  doge: 'Dogecoin',
  zec: 'Zcash',
  bera: 'Berachain',
  monad: 'Monad',
  xlayer: 'X Layer',
  plasma: 'Plasma',
  cardano: 'Cardano',
  ltc: 'Litecoin',
  bch: 'Bitcoin Cash',
};

export function chainName(code: string): string {
  return CHAIN_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

/**
 * The stablecoins small businesses actually get paid in, in the order we show them. `contract` is
 * the canonical token contract (part of the NEAR Intents asset id) to tell it apart from bridged
 * look-alikes on the same chain.
 */
export const RECOMMENDED_TOKENS: readonly { symbol: string; chain: string; contract?: string }[] = [
  { symbol: 'USDC', chain: 'base', contract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  { symbol: 'USDC', chain: 'sol' },
  { symbol: 'USDC', chain: 'eth', contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' },
  { symbol: 'USDC', chain: 'arb', contract: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' },
  { symbol: 'USDC', chain: 'pol', contract: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359' },
  { symbol: 'USDC', chain: 'near', contract: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1' },
  { symbol: 'USDT', chain: 'tron' },
  { symbol: 'USDT', chain: 'bsc', contract: '0x55d398326f99059ff775485246999027b3197955' },
  { symbol: 'USDT', chain: 'eth', contract: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
];

/** Picks the recommended tokens present in the catalog, in the recommended order. */
export function recommendedTokens(tokens: readonly Token[]): Token[] {
  const out: Token[] = [];
  for (const rec of RECOMMENDED_TOKENS) {
    const candidates = tokens.filter((tk) => tk.symbol.toUpperCase() === rec.symbol && tk.blockchain.toLowerCase() === rec.chain && !isDeprecated(tk));
    const contract = rec.contract;
    const best = (contract ? candidates.find((tk) => tk.assetId.toLowerCase().includes(contract)) : undefined) ?? candidates[0];
    if (best) out.push(best);
  }
  return out;
}

export const isDeprecated = (tk: Pick<Token, 'symbol' | 'assetId'>) => /deprecated/i.test(`${tk.symbol} ${tk.assetId}`);

/** Dollar stablecoins (USDC, USDT, DAI, USDC.e…) priced near 1 USD. */
export function isStablecoin(tk: Pick<Token, 'symbol' | 'priceUsd'>): boolean {
  if (!/USD|DAI/i.test(tk.symbol)) return false;
  return !Number.isFinite(tk.priceUsd) || (tk.priceUsd > 0.95 && tk.priceUsd < 1.05);
}
