import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { endpoints } from './endpoints';
import type {
  AgentRun,
  AgentRunMode,
  AgentRunSummary,
  BillInput,
  BillStatus,
  ChangePasswordRequest,
  CreateFundingRequest,
  CreateTreasurySetupRequest,
  CreateUserRequest,
  Funding,
  FundingStatus,
  Instance,
  PayeeInput,
  Payment,
  PaymentStatus,
  PolicyInput,
  SettingsInput,
  TreasuryOverview,
  TreasurySetup,
  TreasurySetupStatus,
  UpdateUserRequest,
} from './types';

export const queryKeys = {
  instance: ['instance'] as const,
  me: ['me'] as const,
  users: ['users'] as const,
  dashboard: ['dashboard'] as const,
  tokens: ['tokens'] as const,
  payees: ['payees'] as const,
  bills: (status?: BillStatus) => ['bills', status ?? 'all'] as const,
  billsRoot: ['bills'] as const,
  policy: ['policy'] as const,
  agentRuns: ['agent-runs'] as const,
  agentRun: (id: string) => ['agent-runs', id] as const,
  payments: (status?: PaymentStatus) => ['payments', status ?? 'all'] as const,
  paymentsRoot: ['payments'] as const,
  payment: (id: string) => ['payment', id] as const,
  audit: ['audit'] as const,
  settings: ['settings'] as const,
  version: ['version'] as const,
  treasury: ['treasury'] as const,
  fundingOptions: ['treasury', 'funding-options'] as const,
  fundings: ['treasury', 'fundings'] as const,
  treasuryMovements: ['treasury', 'movements'] as const,
};

export const AGENT_POLL_MS = 2000;

// ---------- Queries ----------

/** Public instance info (demo / first-run). Fetched once at startup and cached for the session. */
export const useInstance = () =>
  useQuery({
    queryKey: queryKeys.instance,
    queryFn: ({ signal }) => endpoints.instance(signal),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    // A failed lookup must not refetch each time a page mounts: the gate would flip back to its
    // loader, remount the page and loop. On error the app falls back to the normal login.
    retryOnMount: false,
  });

/** True only when the server says this is the public demo instance. */
export function useIsDemo(): boolean {
  return useInstance().data?.demo ?? false;
}

export const useUsers = (enabled = true) =>
  useQuery({ queryKey: queryKeys.users, queryFn: ({ signal }) => endpoints.users(signal), enabled });

export const useDashboard = () =>
  useQuery({ queryKey: queryKeys.dashboard, queryFn: ({ signal }) => endpoints.dashboard(signal) });

export const useTokens = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.tokens,
    queryFn: ({ signal }) => endpoints.tokens(signal),
    staleTime: 10 * 60_000,
    enabled,
  });

export const usePayees = () => useQuery({ queryKey: queryKeys.payees, queryFn: ({ signal }) => endpoints.payees(signal) });

export const useBills = (status?: BillStatus) =>
  useQuery({ queryKey: queryKeys.bills(status), queryFn: ({ signal }) => endpoints.bills(status, signal) });

export const usePolicy = (enabled = true) =>
  useQuery({ queryKey: queryKeys.policy, queryFn: ({ signal }) => endpoints.policy(signal), enabled });

const anyRunning = (runs: AgentRunSummary[] | undefined) => runs?.some((r) => r.status === 'Running') ?? false;

export const useAgentRuns = () =>
  useQuery({
    queryKey: queryKeys.agentRuns,
    queryFn: ({ signal }) => endpoints.agentRuns(signal),
    refetchInterval: (query) => (anyRunning(query.state.data) ? AGENT_POLL_MS : false),
  });

export const useAgentRun = (id: string | undefined) =>
  useQuery({
    queryKey: queryKeys.agentRun(id ?? ''),
    queryFn: ({ signal }) => endpoints.agentRun(id ?? '', signal),
    enabled: Boolean(id),
    refetchInterval: (query) => (query.state.data?.status === 'Running' ? AGENT_POLL_MS : false),
  });

/** Statuses a payment moves out of on its own (jobs, NEAR Intents): the UI keeps them fresh. */
export const IN_TRANSIT_STATUSES: readonly PaymentStatus[] = ['Approved', 'AwaitingDeposit', 'Processing'];
export const PAYMENTS_POLL_MS = 5000;

export const paymentsRefetchInterval = (payments: readonly { status: PaymentStatus }[] | undefined): number | false =>
  payments?.some((p) => IN_TRANSIT_STATUSES.includes(p.status)) ? PAYMENTS_POLL_MS : false;

export const usePayments = (status?: PaymentStatus) =>
  useQuery({
    queryKey: queryKeys.payments(status),
    queryFn: ({ signal }) => endpoints.payments(status, signal),
    refetchInterval: (query) => paymentsRefetchInterval(query.state.data),
  });

export const usePendingApprovals = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.payments('PendingApproval'),
    queryFn: ({ signal }) => endpoints.payments('PendingApproval', signal),
    refetchInterval: 30_000,
    enabled,
  });

export const usePayment = (id: string | undefined) =>
  useQuery({
    queryKey: queryKeys.payment(id ?? ''),
    queryFn: ({ signal }) => endpoints.payment(id ?? '', signal),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s && IN_TRANSIT_STATUSES.includes(s) ? PAYMENTS_POLL_MS : false;
    },
  });

export const useAudit = (take = 100) =>
  useQuery({ queryKey: [...queryKeys.audit, take], queryFn: ({ signal }) => endpoints.audit(take, signal) });

export const useSettings = (enabled = true) =>
  useQuery({ queryKey: queryKeys.settings, queryFn: ({ signal }) => endpoints.settings(signal), enabled });

export const useVersion = () =>
  useQuery({ queryKey: queryKeys.version, queryFn: ({ signal }) => endpoints.version(signal), staleTime: Infinity });

// ---------- On-chain treasury (ADR-0007) ----------

/** While the wizard waits for the NEAR deposit or the server deploys, the page refreshes on its own. */
export const TREASURY_POLL_MS = 5000;
export const FUNDINGS_POLL_MS = 10_000;
const SETUP_IN_PROGRESS: readonly TreasurySetupStatus[] = ['AwaitingFunds', 'Deploying'];
/** Funding statuses that still change on their own (1Click). */
export const FUNDING_OPEN_STATUSES: readonly FundingStatus[] = ['PendingDeposit', 'Processing'];

export const treasuryRefetchInterval = (data: TreasuryOverview | undefined): number | false =>
  data?.setup && SETUP_IN_PROGRESS.includes(data.setup.status) ? TREASURY_POLL_MS : false;

/** After "Freeze now" the chain read can lag (15 s server cache): poll every 2 s for up to 20 s. */
export const FREEZE_POLL_MS = 2000;
export const FREEZE_POLL_WINDOW_MS = 20_000;
/** Per query client: until when a freeze we just sent may not be visible on-chain yet. */
const freezeDeadlines = new WeakMap<QueryClient, number>();

/** The overview as it reads once the contract is paused (optimistic, right after "Freeze now"). */
export function asFrozen(o: TreasuryOverview): TreasuryOverview {
  return {
    ...o,
    onChain: o.onChain ? { ...o.onChain, paused: true } : o.onChain,
    checks: o.checks.map((c) => (c.id === 'notPaused' ? { ...c, ok: false } : c)),
    readyForLive: false,
  };
}

/** Keeps a just-sent freeze visible until the chain confirms it (or the window ends). */
function settleFreeze(qc: QueryClient, data: TreasuryOverview): TreasuryOverview {
  const deadline = freezeDeadlines.get(qc);
  if (deadline === undefined) return data;
  if (data.onChain?.paused || Date.now() >= deadline) {
    freezeDeadlines.delete(qc);
    return data;
  }
  return asFrozen(data);
}

export function useTreasury(enabled = true) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: queryKeys.treasury,
    queryFn: async ({ signal }) => settleFreeze(qc, await endpoints.treasury(signal)),
    refetchInterval: (query) => (freezeDeadlines.has(qc) ? FREEZE_POLL_MS : treasuryRefetchInterval(query.state.data)),
    enabled,
  });
}

export const useFundingOptions = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.fundingOptions,
    queryFn: ({ signal }) => endpoints.fundingOptions(signal),
    staleTime: 10 * 60_000,
    enabled,
  });

export const fundingsRefetchInterval = (fundings: readonly Funding[] | undefined): number | false =>
  fundings?.some((f) => FUNDING_OPEN_STATUSES.includes(f.status)) ? FUNDINGS_POLL_MS : false;

export const useFundings = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.fundings,
    queryFn: ({ signal }) => endpoints.fundings(signal),
    refetchInterval: (query) => fundingsRefetchInterval(query.state.data),
    enabled,
  });

export const useTreasuryMovements = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.treasuryMovements,
    queryFn: ({ signal }) => endpoints.treasuryMovements(signal),
    // The server caches NearBlocks for 60 s.
    staleTime: 60_000,
    refetchInterval: 60_000,
    enabled,
  });

/** Puts a wizard answer into the cached overview right away (the refetch confirms it). */
function patchSetup(qc: QueryClient, setup: TreasurySetup | null): void {
  qc.setQueryData<TreasuryOverview>(queryKeys.treasury, (old) =>
    old ? { ...old, setup, ownerAccountId: old.ownerAccountId ?? setup?.ownerAccountId ?? null } : old,
  );
}

/** Only the overview itself; fundings and movements have their own keys under `treasury`. */
const invalidateTreasury = (qc: QueryClient) => qc.invalidateQueries({ queryKey: queryKeys.treasury, exact: true });

export function useCreateTreasurySetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTreasurySetupRequest) => endpoints.createTreasurySetup(body),
    onSuccess: (setup) => {
      patchSetup(qc, setup);
      void invalidateTreasury(qc);
    },
  });
}

/** Runs the server-side creation (~10–30 s). Afterwards the treasury account in Settings changes. */
export function useDeployTreasury() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => endpoints.deployTreasury(),
    onSuccess: (setup) => patchSetup(qc, setup),
    onSettled: () => {
      void invalidateTreasury(qc);
      void qc.invalidateQueries({ queryKey: queryKeys.settings });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
      void qc.invalidateQueries({ queryKey: queryKeys.audit });
    },
  });
}

export function useCancelTreasurySetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => endpoints.cancelTreasurySetup(),
    onSuccess: () => {
      patchSetup(qc, null);
      void invalidateTreasury(qc);
    },
  });
}

export function useCreateFunding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFundingRequest) => endpoints.createFunding(body),
    onSuccess: (funding) => {
      qc.setQueryData<Funding[]>(queryKeys.fundings, (old) => [funding, ...(old ?? []).filter((f) => f.id !== funding.id)]);
      void qc.invalidateQueries({ queryKey: queryKeys.fundings });
    },
  });
}

/** A funding reached a final state: balances, movements and the dashboard change. */
export function useRefreshAfterFunding() {
  const qc = useQueryClient();
  return useCallback(() => {
    void invalidateTreasury(qc);
    void qc.invalidateQueries({ queryKey: queryKeys.treasuryMovements });
    void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    void qc.invalidateQueries({ queryKey: queryKeys.settings });
  }, [qc]);
}

// ---------- Mutations ----------

export function useSavePayee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: PayeeInput }) =>
      id ? endpoints.updatePayee(id, input) : endpoints.createPayee(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.payees });
    },
  });
}

export function useArchivePayee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => endpoints.archivePayee(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.payees });
    },
  });
}

export function useExtractBill() {
  return useMutation({ mutationFn: (text: string) => endpoints.extractBill(text) });
}

export function useSaveBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: BillInput }) =>
      id ? endpoints.updateBill(id, input) : endpoints.createBill(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.billsRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useCancelBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => endpoints.cancelBill(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.billsRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

export function useUpdatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PolicyInput) => endpoints.updatePolicy(input),
    onSuccess: (policy) => {
      qc.setQueryData(queryKeys.policy, policy);
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
      void qc.invalidateQueries({ queryKey: queryKeys.treasury, exact: true });
    },
  });
}

/** Stops (or resumes) every payment at once: the `agentEnabled` switch. Never pauses the contract. */
export function usePaymentsSwitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (action: 'stop' | 'resume') => (action === 'stop' ? endpoints.stopPayments() : endpoints.resumePayments()),
    onSuccess: (policy) => {
      qc.setQueryData(queryKeys.policy, policy);
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
      void qc.invalidateQueries({ queryKey: queryKeys.audit });
    },
  });
}

/** Emergency freeze of the treasury contract on NEAR (signed by the agent). */
export function useFreezeTreasury() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => endpoints.freezeTreasury(),
    onSuccess: (overview) => {
      // Show "Frozen" right away; the chain read may still say otherwise for a few seconds.
      if (!overview.onChain?.paused) freezeDeadlines.set(qc, Date.now() + FREEZE_POLL_WINDOW_MS);
      // Setting the data restarts the treasury query's refetch timer: it now polls every 2 s.
      qc.setQueryData(queryKeys.treasury, asFrozen(overview));
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
      void qc.invalidateQueries({ queryKey: queryKeys.audit });
    },
  });
}

/**
 * After the owner wallet signed something (withdraw, unpause, limits): balances and limits change.
 * The server caches chain reads for 15 s, so we refresh now and once more after the cache expires.
 */
export function useRefreshAfterOwnerTx() {
  const qc = useQueryClient();
  return useCallback(() => {
    const refresh = () => {
      void invalidateTreasury(qc);
      void qc.invalidateQueries({ queryKey: queryKeys.treasuryMovements });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    };
    refresh();
    window.setTimeout(refresh, 16_000);
  }, [qc]);
}

export function useRunAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: AgentRunMode = 'Plan') => endpoints.runAgent(mode),
    onSuccess: (run) => {
      qc.setQueryData<AgentRunSummary[]>(queryKeys.agentRuns, (old) => [run, ...(old ?? []).filter((r) => r.id !== run.id)]);
      void qc.invalidateQueries({ queryKey: queryKeys.agentRuns });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
  });
}

/** Invalidate everything an agent run can change once it finishes. */
export function useInvalidateAfterRun() {
  const qc = useQueryClient();
  return useCallback(
    (run: AgentRun | AgentRunSummary) => {
      if (run.status === 'Running') return;
      void qc.invalidateQueries({ queryKey: queryKeys.agentRuns });
      void qc.invalidateQueries({ queryKey: queryKeys.paymentsRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.billsRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
    [qc],
  );
}

type Decision = { kind: 'approve'; id: string; note?: string } | { kind: 'reject'; id: string; note: string };

/** Approve/reject with an optimistic removal from the pending-approval inbox. */
export function useDecidePayment() {
  const qc = useQueryClient();
  const pendingKey = queryKeys.payments('PendingApproval');
  return useMutation({
    mutationFn: (d: Decision) =>
      d.kind === 'approve' ? endpoints.approvePayment(d.id, d.note) : endpoints.rejectPayment(d.id, d.note),
    onMutate: async (d) => {
      await qc.cancelQueries({ queryKey: pendingKey });
      const previous = qc.getQueryData<Payment[]>(pendingKey);
      qc.setQueryData<Payment[]>(pendingKey, (old) => old?.filter((p) => p.id !== d.id));
      return { previous };
    },
    onError: (_err, _d, context) => {
      if (context?.previous) qc.setQueryData(pendingKey, context.previous);
    },
    onSuccess: (payment) => {
      qc.setQueryData(queryKeys.payment(payment.id), payment);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.paymentsRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
      void qc.invalidateQueries({ queryKey: queryKeys.audit });
    },
  });
}

export function useSubmitDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, txHash }: { id: string; txHash: string }) => endpoints.submitDeposit(id, txHash),
    onSuccess: (payment) => {
      qc.setQueryData(queryKeys.payment(payment.id), payment);
      void qc.invalidateQueries({ queryKey: queryKeys.paymentsRoot });
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SettingsInput) => endpoints.updateSettings(input),
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.settings, settings);
      void qc.invalidateQueries({ queryKey: queryKeys.dashboard });
      // Mode and treasury account show up on the Treasury page too.
      void qc.invalidateQueries({ queryKey: queryKeys.treasury });
    },
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: (body: ChangePasswordRequest) => endpoints.changePassword(body) });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserRequest) => endpoints.createUser(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.users });
      void qc.invalidateQueries({ queryKey: queryKeys.audit });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserRequest }) => endpoints.updateUser(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.users });
      void qc.invalidateQueries({ queryKey: queryKeys.audit });
    },
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) => endpoints.resetUserPassword(id, newPassword),
  });
}

/** Reset the public demo; every cached query is refetched afterwards. */
export function useResetDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => endpoints.resetDemo(),
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });
}

/**
 * Clears every cached query except the public instance info (no loader flash on sign-in/out).
 * The instance query is never removed, not even while it is still loading: a 401 can land before
 * it resolves, and dropping it then would leave the router gate waiting forever.
 */
export function clearPreservingInstance(qc: QueryClient): void {
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== queryKeys.instance[0] });
  qc.getMutationCache().clear();
}

/** Marks the instance as set up after the first Owner is created. */
export function markInstanceSetUp(qc: QueryClient, organizationName: string): void {
  // Without cached instance info (the lookup failed) the gate already treats it as set up.
  qc.setQueryData<Instance>(queryKeys.instance, (old) =>
    old ? { ...old, needsSetup: false, organizationName, setupTokenRequired: false } : old,
  );
}
