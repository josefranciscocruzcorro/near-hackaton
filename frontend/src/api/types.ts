// Types mirror docs/api/CONTRACT.md (API v1) one-to-one. Change the contract first.

export type Role = 'Owner' | 'Approver' | 'Auditor';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: User;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Minimum password length enforced by the API (setup, change, invite, reset). */
export const MIN_PASSWORD_LENGTH = 12;

// ---------- Instance / tenants / first-run setup (public, ADR-0006) ----------

/** `landing` = the apex domain (public landing + signup); `tenant` = `<slug>.<baseDomain>`. */
export type InstanceKind = 'landing' | 'tenant';

export interface Instance {
  kind: InstanceKind;
  /** The public demo tenant. */
  demo: boolean;
  /** Tenant without users: show /setup. */
  needsSetup: boolean;
  /** Real tenants require the one-time setup code sent by email after the signup is verified. */
  setupTokenRequired: boolean;
  /** Tenant name (also before the first Owner exists). */
  organizationName: string | null;
  tenantSlug: string | null;
  /** e.g. "tesorero.gesco.ec" */
  baseDomain: string;
  /** e.g. "https://demo.tesorero.gesco.ec" */
  demoUrl: string;
  /** e.g. "https://tesorero.gesco.ec" */
  landingUrl: string;
  /** Language chosen at signup (tenant); the UI uses it until the person picks one. */
  language?: SignupLanguage | null;
}

export interface SetupRequest {
  organizationName: string;
  ownerName: string;
  email: string;
  password: string;
  setupToken: string | null;
}

// ---------- Signup (landing only; 404 from a tenant) ----------

export type SlugUnavailableReason = 'taken' | 'reserved' | 'invalid';

/** GET /api/signup/slug?value= — `slug` comes back normalized (lowercase). */
export interface SlugCheck {
  slug: string;
  available: boolean;
  reason: SlugUnavailableReason | null;
}

/** GET /api/signup/near?accountId= — checked against NEAR mainnet (`view_account`). */
export interface NearAccountCheck {
  accountId: string;
  exists: boolean;
  /** false when the value is not a NEAR account id. */
  valid: boolean;
}

export type SignupLanguage = 'en' | 'es';

export interface SignupRequest {
  organizationName: string;
  slug: string;
  ownerName: string;
  email: string;
  nearAccountId: string;
  language: SignupLanguage;
  acceptTerms: boolean;
  /** Honeypot: always "" from a human (the input is hidden). */
  website: string;
}

/** 202: the verification email was sent. */
export interface SignupResponse {
  email: string;
}

export interface VerifySignupRequest {
  token: string;
}

/** 200: tenant created and the setup email sent. */
export interface VerifySignupResponse {
  organizationName: string;
  slug: string;
  tenantUrl: string;
  email: string;
}

/** Slug rules (CONTRACT.md): 3–30 chars `[a-z0-9-]`, no leading or trailing hyphen. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;
export const SLUG_MAX_LENGTH = 30;

// ---------- Users (Owner) ----------

export const ROLES = ['Owner', 'Approver', 'Auditor'] as const satisfies readonly Role[];

export interface UserAdmin {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface CreateUserRequest {
  email: string;
  name: string;
  role: Role;
  password: string;
}

export interface UpdateUserRequest {
  name: string;
  role: Role;
  isActive: boolean;
}

export interface ResetPasswordRequest {
  newPassword: string;
}

/** RFC 7807 problem details. */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  errors?: Record<string, string[]>;
}

export const CATEGORIES = ['Supplier', 'Contractor', 'Payroll', 'Software', 'Operations', 'Marketing'] as const;
export type Category = (typeof CATEGORIES)[number];

export type ExecutionMode = 'Simulation' | 'Live';

// ---------- Dashboard ----------

export interface Treasury {
  configured: boolean;
  accountId: string | null;
  network: 'mainnet';
  usdcBalance: number | null;
  nearBalance: number | null;
  updatedAt: string | null;
  /** null when the treasury is not a Tesorero contract or it could not be read. */
  onChain: OnChainGuard | null;
}

/** Limits enforced by the NEAR treasury contract (ADR-0005). USD amounts (USDC, already converted). */
export interface OnChainGuard {
  contractId: string;
  agentId: string | null;
  maxPerPayment: number;
  dailyLimit: number;
  spentToday: number;
  remainingToday: number;
  paused: boolean;
}

export interface Spend {
  today: number;
  dailyLimit: number;
  month: number;
  monthlyLimit: number;
}

export interface CategoryBudgetUsage {
  category: Category;
  spent: number;
  budget: number;
}

export interface Dashboard {
  treasury: Treasury;
  spend: Spend;
  categoryBudgets: CategoryBudgetUsage[];
  pendingApprovals: number;
  upcomingBills: Bill[];
  recentPayments: Payment[];
  lastAgentRun: AgentRunSummary | null;
  executionMode: ExecutionMode;
  agentEnabled: boolean;
}

// ---------- Tokens ----------

export interface Token {
  assetId: string;
  symbol: string;
  blockchain: string;
  decimals: number;
  priceUsd: number;
}

// ---------- Payees ----------

export interface PayeeInput {
  name: string;
  email?: string | null;
  category: Category;
  destinationAssetId: string;
  recipientAddress: string;
  isAllowlisted: boolean;
  notes?: string | null;
}

export type Payee = PayeeInput & {
  id: string;
  destinationSymbol: string;
  destinationChain: string;
  createdAt: string;
  addressChangedAt: string;
};

// ---------- Bills ----------

export const BILL_STATUSES = ['Open', 'Scheduled', 'Paid', 'Cancelled'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];
export type BillSource = 'Manual' | 'AiExtracted';
export type BillFlag = 'PaymentDetailsMismatch' | 'SuspiciousInstructions';

export interface BillInput {
  payeeId: string;
  reference: string;
  description: string;
  amountUsd: number;
  /** yyyy-MM-dd */
  dueDate: string;
  category: Category;
  extractionId?: string | null;
}

export interface Bill {
  id: string;
  payeeId: string;
  payeeName: string;
  reference: string;
  description: string;
  amountUsd: number;
  dueDate: string;
  category: Category;
  status: BillStatus;
  source: BillSource;
  flags: BillFlag[];
  createdAt: string;
  createdBy: string;
}

export interface ExtractRequest {
  text: string;
}

export interface PaymentInstructions {
  chain: string | null;
  token: string | null;
  address: string | null;
}

export interface ExtractionFields {
  payeeName: string | null;
  amountUsd: number | null;
  currency: string | null;
  dueDate: string | null;
  reference: string | null;
  description: string | null;
  category: Category | null;
  paymentInstructions: PaymentInstructions | null;
}

export interface ExtractionWarning {
  code: string;
  message: string;
}

export interface Extraction {
  extractionId: string;
  fields: ExtractionFields;
  matchedPayeeId: string | null;
  flags: BillFlag[];
  warnings: ExtractionWarning[];
}

// ---------- Policy ----------

export interface PolicyInput {
  agentEnabled: boolean;
  maxPerPaymentUsd: number;
  approvalThresholdUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  minReserveUsd: number;
  requireAllowlistedPayee: boolean;
  newPayeeCooldownHours: number;
  planningHorizonDays: number;
  categoryBudgets: Record<Category, number>;
}

export type Policy = PolicyInput & {
  version: number;
  updatedAt: string;
  updatedBy: string;
};

// ---------- Agent ----------

export type PolicyOutcome = 'Allow' | 'RequireApproval' | 'Block';
export type PolicyReasonSeverity = 'info' | 'warn' | 'block';

export const POLICY_REASON_CODES = [
  'AgentDisabled',
  'PayeeNotAllowlisted',
  'PayeeArchived',
  'ExceedsMaxPerPayment',
  'ExceedsDailyLimit',
  'ExceedsMonthlyLimit',
  'ExceedsCategoryBudget',
  'BelowReserve',
  'TreasuryBalanceUnknown',
  'NewPayeeCooldown',
  'AboveApprovalThreshold',
  'PaymentDetailsMismatch',
  'SuspiciousInstructions',
  'InvalidAmount',
  'WithinPolicy',
] as const;
export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];

export interface PolicyReason {
  /** One of PolicyReasonCode; typed as string because the server may add codes. */
  code: string;
  message: string;
  severity: PolicyReasonSeverity;
}

export type AgentRunTrigger = 'Scheduled' | 'Manual' | 'RedTeamDrill';
export type AgentRunMode = 'Plan' | 'RedTeamDrill';

export interface StartAgentRunRequest {
  mode?: AgentRunMode;
}
export type AgentRunStatus = 'Running' | 'Completed' | 'Failed';

export interface AgentRunSummary {
  id: string;
  trigger: AgentRunTrigger;
  status: AgentRunStatus;
  startedAt: string;
  finishedAt: string | null;
  model: string | null;
  summary: string | null;
  proposed: number;
  allowed: number;
  needsApproval: number;
  blocked: number;
}

export interface AgentDecision {
  billId: string;
  billReference: string;
  payeeName: string;
  amountUsd: number;
  payNow: boolean;
  aiReason: string;
  paymentId: string | null;
  policyOutcome: PolicyOutcome | null;
  policyReasons: PolicyReason[];
}

export type AgentRun = AgentRunSummary & {
  promptTokens: number;
  completionTokens: number;
  error: string | null;
  decisions: AgentDecision[];
};

// ---------- Payments ----------

export const PAYMENT_STATUSES = [
  'PendingApproval',
  'Approved',
  'Blocked',
  'Rejected',
  'AwaitingDeposit',
  'Processing',
  'Settled',
  'Refunded',
  'Failed',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface Quote {
  amountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: number | null;
  depositAddress: string | null;
  deadline: string | null;
  quotedAt: string;
}

export interface Payment {
  id: string;
  billId: string;
  billReference: string;
  payeeId: string;
  payeeName: string;
  category: Category;
  amountUsd: number;
  originAssetId: string;
  destinationAssetId: string;
  destinationSymbol: string;
  destinationChain: string;
  recipient: string;
  status: PaymentStatus;
  policyOutcome: PolicyOutcome;
  policyReasons: PolicyReason[];
  aiReason: string | null;
  simulation: boolean;
  quote: Quote | null;
  depositTxHash: string | null;
  intentStatus: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  settledAt: string | null;
  explorerUrl: string | null;
  /** NEAR tx of `treasury.pay` signed by the agent. */
  onChainTxHash: string | null;
  /** https://nearblocks.io/txns/<hash> */
  onChainTxUrl: string | null;
  lastError: string | null;
}

export interface ApproveRequest {
  note?: string;
}

export interface RejectRequest {
  note: string;
}

export interface DepositRequest {
  txHash: string;
}

// ---------- Audit ----------

export type ActorType = 'User' | 'Agent' | 'System';

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  actorType: ActorType;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
}

// ---------- Settings / system ----------

export interface Settings {
  organizationName: string;
  treasuryAccountId: string | null;
  executionMode: ExecutionMode;
  network: 'mainnet';
  demo: boolean;
  /** NEAR account of the agent configured on the server (null = manual Live). Informational only. */
  agentAccountId: string | null;
  /** Latest balances read from NEAR mainnet for the treasury account; refreshed on every save. */
  treasuryBalance: TreasuryBalance | null;
}

export interface TreasuryBalance {
  usdc: number | null;
  near: number | null;
  capturedAt: string;
}

export type SettingsInput = Pick<Settings, 'organizationName' | 'treasuryAccountId' | 'executionMode'>;

export interface VersionInfo {
  version: string;
  commit: string;
  builtAt: string;
}

// ---------- On-chain treasury (ADR-0007) ----------
// Every USDC/NEAR amount is a `number` in human units (not base units).

export const TREASURY_CHECK_IDS = [
  'contract',
  'agent',
  'locked',
  'usdcRegistered',
  'agentGas',
  'funded',
  'reserveCovered',
  'notPaused',
] as const;
export type TreasuryCheckId = (typeof TREASURY_CHECK_IDS)[number];

export interface TreasuryCheck {
  id: TreasuryCheckId;
  ok: boolean;
}

export type TreasurySetupStatus = 'AwaitingFunds' | 'Deploying' | 'Ready' | 'Failed';
export const TREASURY_SETUP_STEP_IDS = ['deploy', 'register', 'agentGas', 'lock'] as const;
export type TreasurySetupStepId = (typeof TREASURY_SETUP_STEP_IDS)[number];
export type TreasurySetupStepStatus = 'pending' | 'done' | 'failed';

export interface TreasurySetupStep {
  id: TreasurySetupStepId;
  status: TreasurySetupStepStatus;
  txHash: string | null;
}

export interface TreasurySetup {
  id: string;
  status: TreasurySetupStatus;
  ownerAccountId: string;
  /** On-chain limits in USDC. */
  maxPerPayment: number;
  dailyLimit: number;
  /** Implicit account (64 hex) that becomes the contract: the NEAR deposit goes here. */
  accountId: string;
  /** 2.5 recommended. */
  requiredNear: number;
  /** 2.2 minimum to create. */
  minimumNear: number;
  /** Current balance of `accountId` (null if it could not be read / does not exist yet → 0). */
  receivedNear: number | null;
  /** sha256 hex of the wasm that will be deployed. */
  codeHash: string;
  steps: TreasurySetupStep[];
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface TreasuryBalances {
  treasuryUsdc: number | null;
  treasuryNear: number | null;
  agentNear: number | null;
  readAt: string;
}

export interface TreasuryOverview {
  /** Contract account saved in Settings. */
  treasuryAccountId: string | null;
  /** Owner wallet (from get_config, or from the wizard while there is no contract yet). */
  ownerAccountId: string | null;
  /** This organization's agent account (64 hex). */
  agentAccountId: string | null;
  usdcContractId: string;
  executionMode: ExecutionMode;
  demo: boolean;
  /** Latest creation wizard (null if never used). */
  setup: TreasurySetup | null;
  /** Read live (15 s cache). */
  balances: TreasuryBalances | null;
  onChain: OnChainGuard | null;
  /** Empty when there is no treasury account. */
  checks: TreasuryCheck[];
  /** Every check is ok. */
  readyForLive: boolean;
  /** NEAR account verified at signup: prefills the owner wallet in the setup wizard. */
  suggestedOwnerAccountId?: string | null;
}

export interface CreateTreasurySetupRequest {
  ownerAccountId: string;
  maxPerPayment: number;
  dailyLimit: number;
}

export type FundingSymbol = 'USDT' | 'USDC';

export interface FundingAsset {
  assetId: string;
  symbol: FundingSymbol;
  chain: string;
  chainName: string;
  decimals: number;
}

export interface FundingOptions {
  assets: FundingAsset[];
}

export const FUNDING_STATUSES = ['PendingDeposit', 'Processing', 'Success', 'Refunded', 'Failed', 'Expired'] as const;
export type FundingStatus = (typeof FUNDING_STATUSES)[number];

export interface Funding {
  id: string;
  originAssetId: string;
  symbol: string;
  chain: string;
  chainName: string;
  amountIn: number;
  expectedUsdc: number;
  depositAddress: string;
  depositMemo: string | null;
  deadline: string;
  refundAddress: string;
  status: FundingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFundingRequest {
  originAssetId: string;
  amount: number;
  refundAddress: string;
}

export type MovementDirection = 'in' | 'out';
export type MovementKind = 'payment' | 'funding' | 'setup' | 'other';

export interface Movement {
  txHash: string;
  at: string;
  direction: MovementDirection;
  /** "NEAR" | "USDC" | symbol/contract of another token */
  asset: string;
  amount: number;
  counterparty: string | null;
  kind: MovementKind;
  paymentId: string | null;
  /** Bill reference when it is a Tesorero payment. */
  reference: string | null;
  /** USDC outflow that Tesorero did not start → alert. */
  flagged: boolean;
}

export interface TreasuryMovements {
  accountId: string | null;
  items: Movement[];
  alerts: number;
  /** Set when the indexer (NearBlocks) did not answer. */
  error: string | null;
}
