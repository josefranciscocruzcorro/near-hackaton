import { http, HttpResponse } from 'msw';
import { TREASURY_CHECK_IDS } from '../api/types';
import type {
  Dashboard,
  Funding,
  FundingAsset,
  Instance,
  Movement,
  Payment,
  Settings,
  TreasuryCheck,
  TreasuryOverview,
  TreasurySetup,
  User,
} from '../api/types';
import { USERS } from './utils';

export const problem = (status: number, detail: string, errors?: Record<string, string[]>) =>
  HttpResponse.json(
    { title: detail, status, detail, ...(errors ? { errors } : {}) },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

export function makeInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    kind: 'tenant',
    demo: false,
    needsSetup: false,
    organizationName: 'Acme Imports',
    setupTokenRequired: false,
    tenantSlug: 'acme',
    baseDomain: 'tesorero.gesco.ec',
    demoUrl: 'https://demo.tesorero.gesco.ec',
    landingUrl: 'https://tesorero.gesco.ec',
    ...overrides,
  };
}

export function instanceHandler(instance: Partial<Instance> = {}) {
  return http.get('*/api/instance', () => HttpResponse.json<Instance>(makeInstance(instance)));
}

/** The apex landing (`tesorero.gesco.ec`): no tenant, only the public signup APIs. */
export function landingInstanceHandler(overrides: Partial<Instance> = {}) {
  return instanceHandler({ kind: 'landing', organizationName: null, tenantSlug: null, ...overrides });
}

/** GET /api/auth/me answering with the signed-in test user (see `signInAs`). */
export function meHandler(user: User = USERS.Owner) {
  return http.get('*/api/auth/me', () => HttpResponse.json(user));
}

export function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    organizationName: 'Acme Imports',
    treasuryAccountId: 'acme-treasury.near',
    executionMode: 'Simulation',
    network: 'mainnet',
    demo: false,
    agentAccountId: null,
    treasuryBalance: null,
    ...overrides,
  };
}

export function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    billId: 'bill-1',
    billReference: 'INV-1001',
    payeeId: 'payee-1',
    payeeName: 'Andes Coffee Co.',
    category: 'Supplier',
    amountUsd: 1250.5,
    originAssetId: 'nep141:usdc.near',
    destinationAssetId: 'nep141:eth-usdc.omft.near',
    destinationSymbol: 'USDC',
    destinationChain: 'eth',
    recipient: '0x9f1c4b2a3d4e5f60718293a4b5c6d7e8f9012345',
    status: 'Settled',
    policyOutcome: 'Allow',
    policyReasons: [{ code: 'WithinPolicy', message: 'Within every limit.', severity: 'info' }],
    aiReason: 'Due tomorrow.',
    simulation: false,
    quote: null,
    depositTxHash: null,
    intentStatus: null,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: '2026-11-13T10:00:00Z',
    settledAt: null,
    explorerUrl: null,
    onChainTxHash: null,
    onChainTxUrl: null,
    lastError: null,
    ...overrides,
  };
}

export function makeDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    treasury: {
      configured: true,
      accountId: 'acme-treasury.near',
      network: 'mainnet',
      usdcBalance: 25000,
      nearBalance: 3.5,
      updatedAt: '2026-11-13T10:00:00Z',
      onChain: null,
    },
    spend: { today: 500, dailyLimit: 5000, month: 9000, monthlyLimit: 50000 },
    categoryBudgets: [],
    pendingApprovals: 0,
    upcomingBills: [],
    recentPayments: [],
    lastAgentRun: null,
    executionMode: 'Simulation',
    agentEnabled: true,
    ...overrides,
  };
}

// ---------- On-chain treasury (ADR-0007) ----------

export const OWNER_WALLET = 'acme-owner.near';
export const SETUP_ACCOUNT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9a';
export const AGENT_ACCOUNT = 'f00dbabe00112233445566778899aabbccddeeff00112233445566778899aabb';
export const USDC_CONTRACT = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
export const CODE_HASH = '24710670636342b3cc617e9c66d1a39f260350c38ff36c3ee7d8d08dc07b0a19';

export function makeSetup(overrides: Partial<TreasurySetup> = {}): TreasurySetup {
  return {
    id: 'setup-1',
    status: 'AwaitingFunds',
    ownerAccountId: OWNER_WALLET,
    maxPerPayment: 50,
    dailyLimit: 100,
    accountId: SETUP_ACCOUNT,
    requiredNear: 2.5,
    minimumNear: 2.2,
    receivedNear: 0,
    codeHash: CODE_HASH,
    steps: [
      { id: 'deploy', status: 'pending', txHash: null },
      { id: 'register', status: 'pending', txHash: null },
      { id: 'agentGas', status: 'pending', txHash: null },
      { id: 'lock', status: 'pending', txHash: null },
    ],
    lastError: null,
    createdAt: '2026-11-14T10:00:00Z',
    completedAt: null,
    ...overrides,
  };
}

export function readySetup(overrides: Partial<TreasurySetup> = {}): TreasurySetup {
  return makeSetup({
    status: 'Ready',
    receivedNear: 2.5,
    steps: [
      { id: 'deploy', status: 'done', txHash: 'TxDeploy111' },
      { id: 'register', status: 'done', txHash: 'TxRegister222' },
      { id: 'agentGas', status: 'done', txHash: 'TxGas333' },
      { id: 'lock', status: 'done', txHash: 'TxLock444' },
    ],
    completedAt: '2026-11-14T10:05:00Z',
    ...overrides,
  });
}

export const allChecks = (ok = true, except: TreasuryCheck['id'][] = []): TreasuryCheck[] =>
  TREASURY_CHECK_IDS.map((id) => ({
    id,
    ok: except.includes(id) ? !ok : ok,
  }));

/** No treasury and the wizard never used. */
export function makeTreasury(overrides: Partial<TreasuryOverview> = {}): TreasuryOverview {
  return {
    treasuryAccountId: null,
    ownerAccountId: null,
    agentAccountId: AGENT_ACCOUNT,
    usdcContractId: USDC_CONTRACT,
    executionMode: 'Simulation',
    demo: false,
    setup: null,
    balances: null,
    onChain: null,
    checks: [],
    readyForLive: false,
    ...overrides,
  };
}

/** A treasury created by the wizard, locked and verified. */
export function readyTreasury(overrides: Partial<TreasuryOverview> = {}): TreasuryOverview {
  return makeTreasury({
    treasuryAccountId: SETUP_ACCOUNT,
    ownerAccountId: OWNER_WALLET,
    setup: readySetup(),
    balances: { treasuryUsdc: 250, treasuryNear: 1.95, agentNear: 0.3, readAt: new Date().toISOString() },
    onChain: { contractId: SETUP_ACCOUNT, agentId: AGENT_ACCOUNT, maxPerPayment: 50, dailyLimit: 100, spentToday: 20, remainingToday: 80, paused: false },
    checks: allChecks(true),
    readyForLive: true,
    ...overrides,
  });
}

export const FUNDING_ASSETS: FundingAsset[] = [
  { assetId: 'nep141:bsc-0x55d398326f99059ff775485246999027b3197955.omft.near', symbol: 'USDT', chain: 'bsc', chainName: 'BNB Smart Chain', decimals: 18 },
  { assetId: 'nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near', symbol: 'USDT', chain: 'eth', chainName: 'Ethereum', decimals: 6 },
  { assetId: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near', symbol: 'USDT', chain: 'tron', chainName: 'Tron', decimals: 6 },
  { assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', symbol: 'USDC', chain: 'sol', chainName: 'Solana', decimals: 6 },
];

export function makeFunding(overrides: Partial<Funding> = {}): Funding {
  return {
    id: 'fund-1',
    originAssetId: FUNDING_ASSETS[0]?.assetId ?? '',
    symbol: 'USDT',
    chain: 'bsc',
    chainName: 'BNB Smart Chain',
    amountIn: 150,
    expectedUsdc: 149.62,
    depositAddress: '0x1234567890abcdef1234567890abcdef12345678',
    depositMemo: null,
    deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
    refundAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    status: 'PendingDeposit',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeMovement(overrides: Partial<Movement> = {}): Movement {
  return {
    txHash: 'TxMove1',
    at: '2026-11-14T11:00:00Z',
    direction: 'in',
    asset: 'USDC',
    amount: 150,
    counterparty: 'intents.near',
    kind: 'funding',
    paymentId: null,
    reference: null,
    flagged: false,
    ...overrides,
  };
}
