import { api, apiRequest } from './client';
import type {
  AgentRun,
  AgentRunMode,
  AgentRunSummary,
  AuditEntry,
  Bill,
  BillInput,
  BillStatus,
  ChangePasswordRequest,
  CreateFundingRequest,
  CreateTreasurySetupRequest,
  CreateUserRequest,
  Dashboard,
  Extraction,
  Funding,
  FundingOptions,
  Instance,
  LoginRequest,
  LoginResponse,
  NearAccountCheck,
  Payee,
  PayeeInput,
  Payment,
  PaymentStatus,
  Policy,
  PolicyInput,
  Settings,
  SettingsInput,
  SetupRequest,
  SignupRequest,
  SignupResponse,
  SlugCheck,
  StartAgentRunRequest,
  Token,
  TreasuryMovements,
  TreasuryOverview,
  TreasurySetup,
  UpdateUserRequest,
  User,
  UserAdmin,
  VerifySignupRequest,
  VerifySignupResponse,
  VersionInfo,
} from './types';

const enc = encodeURIComponent;

export const endpoints = {
  instance: (signal?: AbortSignal) => api<Instance>('/api/instance', { signal, auth: false }),
  setup: (body: SetupRequest) => api<LoginResponse>('/api/setup', { method: 'POST', body, auth: false }),

  // Signup (landing only)
  checkSlug: (value: string, signal?: AbortSignal) =>
    api<SlugCheck>(`/api/signup/slug?value=${enc(value)}`, { signal, auth: false }),
  checkNearAccount: (accountId: string, signal?: AbortSignal) =>
    api<NearAccountCheck>(`/api/signup/near?accountId=${enc(accountId)}`, { signal, auth: false }),
  signup: (body: SignupRequest) => api<SignupResponse>('/api/signup', { method: 'POST', body, auth: false }),
  verifySignup: (token: string) =>
    api<VerifySignupResponse>('/api/signup/verify', { method: 'POST', body: { token } satisfies VerifySignupRequest, auth: false }),

  login: (body: LoginRequest) => api<LoginResponse>('/api/auth/login', { method: 'POST', body, auth: false }),
  me: (signal?: AbortSignal) => api<User>('/api/auth/me', { signal }),
  changePassword: (body: ChangePasswordRequest) => api<undefined>('/api/auth/change-password', { method: 'POST', body }),

  users: (signal?: AbortSignal) => api<UserAdmin[]>('/api/users', { signal }),
  createUser: (body: CreateUserRequest) => api<UserAdmin>('/api/users', { method: 'POST', body }),
  updateUser: (id: string, body: UpdateUserRequest) => api<UserAdmin>(`/api/users/${enc(id)}`, { method: 'PUT', body }),
  resetUserPassword: (id: string, newPassword: string) =>
    api<undefined>(`/api/users/${enc(id)}/password`, { method: 'PUT', body: { newPassword } }),

  dashboard: (signal?: AbortSignal) => api<Dashboard>('/api/dashboard', { signal }),
  tokens: (signal?: AbortSignal) => api<Token[]>('/api/tokens', { signal }),

  payees: (signal?: AbortSignal) => api<Payee[]>('/api/payees', { signal }),
  createPayee: (body: PayeeInput) => api<Payee>('/api/payees', { method: 'POST', body }),
  updatePayee: (id: string, body: PayeeInput) => api<Payee>(`/api/payees/${enc(id)}`, { method: 'PUT', body }),
  archivePayee: (id: string) => api<undefined>(`/api/payees/${enc(id)}`, { method: 'DELETE' }),

  bills: (status: BillStatus | undefined, signal?: AbortSignal) =>
    api<Bill[]>(status ? `/api/bills?status=${enc(status)}` : '/api/bills', { signal }),
  bill: (id: string, signal?: AbortSignal) => api<Bill>(`/api/bills/${enc(id)}`, { signal }),
  extractBill: (text: string) => api<Extraction>('/api/bills/extract', { method: 'POST', body: { text } }),
  createBill: (body: BillInput) => api<Bill>('/api/bills', { method: 'POST', body }),
  updateBill: (id: string, body: BillInput) => api<Bill>(`/api/bills/${enc(id)}`, { method: 'PUT', body }),
  cancelBill: (id: string) => api<Bill>(`/api/bills/${enc(id)}/cancel`, { method: 'POST' }),

  policy: (signal?: AbortSignal) => api<Policy>('/api/policy', { signal }),
  updatePolicy: (body: PolicyInput) => api<Policy>('/api/policy', { method: 'PUT', body }),

  runAgent: (mode: AgentRunMode = 'Plan') =>
    api<AgentRunSummary>('/api/agent/runs', { method: 'POST', body: { mode } satisfies StartAgentRunRequest }),
  agentRuns: (signal?: AbortSignal) => api<AgentRunSummary[]>('/api/agent/runs', { signal }),
  agentRun: (id: string, signal?: AbortSignal) => api<AgentRun>(`/api/agent/runs/${enc(id)}`, { signal }),

  payments: (status: PaymentStatus | undefined, signal?: AbortSignal) =>
    api<Payment[]>(status ? `/api/payments?status=${enc(status)}` : '/api/payments', { signal }),
  payment: (id: string, signal?: AbortSignal) => api<Payment>(`/api/payments/${enc(id)}`, { signal }),
  approvePayment: (id: string, note?: string) =>
    api<Payment>(`/api/payments/${enc(id)}/approve`, { method: 'POST', body: note ? { note } : {} }),
  rejectPayment: (id: string, note: string) =>
    api<Payment>(`/api/payments/${enc(id)}/reject`, { method: 'POST', body: { note } }),
  submitDeposit: (id: string, txHash: string) =>
    api<Payment>(`/api/payments/${enc(id)}/deposit`, { method: 'POST', body: { txHash } }),
  exportPaymentsCsv: async (): Promise<{ blob: Blob; filename: string | null }> => {
    const res = await apiRequest('/api/payments/export.csv');
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    return { blob: await res.blob(), filename: match?.[1] ? decodeURIComponent(match[1]) : null };
  },

  audit: (take: number, signal?: AbortSignal) => api<AuditEntry[]>(`/api/audit?take=${take}`, { signal }),

  settings: (signal?: AbortSignal) => api<Settings>('/api/settings', { signal }),
  updateSettings: (body: SettingsInput) => api<Settings>('/api/settings', { method: 'PUT', body }),
  // On-chain treasury (ADR-0007)
  treasury: (signal?: AbortSignal) => api<TreasuryOverview>('/api/treasury', { signal }),
  createTreasurySetup: (body: CreateTreasurySetupRequest) => api<TreasurySetup>('/api/treasury/setup', { method: 'POST', body }),
  deployTreasury: () => api<TreasurySetup>('/api/treasury/setup/deploy', { method: 'POST' }),
  cancelTreasurySetup: () => api<undefined>('/api/treasury/setup', { method: 'DELETE' }),
  fundingOptions: (signal?: AbortSignal) => api<FundingOptions>('/api/treasury/funding-options', { signal }),
  fundings: (signal?: AbortSignal) => api<Funding[]>('/api/treasury/fundings', { signal }),
  createFunding: (body: CreateFundingRequest) => api<Funding>('/api/treasury/fundings', { method: 'POST', body }),
  treasuryMovements: (signal?: AbortSignal) => api<TreasuryMovements>('/api/treasury/movements', { signal }),
  /** Emergency: the agent pauses the contract on NEAR; only the owner wallet can unpause it. */
  freezeTreasury: () => api<TreasuryOverview>('/api/treasury/freeze', { method: 'POST' }),

  // Stop / resume every payment at once (the `agentEnabled` switch; does not touch the contract).
  stopPayments: () => api<Policy>('/api/payments/stop', { method: 'POST' }),
  resumePayments: () => api<Policy>('/api/payments/resume', { method: 'POST' }),

  resetDemo: () => api<undefined>('/api/demo/reset', { method: 'POST' }),
  version: (signal?: AbortSignal) => api<VersionInfo>('/api/version', { signal }),
};
