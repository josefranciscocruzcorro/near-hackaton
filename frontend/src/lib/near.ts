// NEAR helpers shared by Settings and the Treasury page (ADR-0007).

const NAMED_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT_ACCOUNT = /^[0-9a-f]{64}$/;

/** NEAR account id format (named like `acme.near`, or a 64-hex implicit account). Existence is checked by the server. */
export function isValidNearAccount(id: string): boolean {
  return NAMED_ACCOUNT.test(id) || IMPLICIT_ACCOUNT.test(id);
}

export const isImplicitAccount = (id: string): boolean => IMPLICIT_ACCOUNT.test(id);

export const nearblocksAccountUrl = (accountId: string) => `https://nearblocks.io/address/${encodeURIComponent(accountId)}`;
export const nearblocksTxUrl = (txHash: string) => `https://nearblocks.io/txns/${encodeURIComponent(txHash)}`;

/** USDC on NEAR has 6 decimals: `1 USDC = 1000000`. */
export const USDC_DECIMALS = 6;

/**
 * Human amount → base-unit integer string without floating point loss: `("100.5", 6)` → `"100500000"`.
 * Returns null when the value is not a non-negative decimal with at most `decimals` fraction digits.
 */
export function toBaseUnits(value: string, decimals: number): string | null {
  const v = value.trim();
  const m = /^(\d+)(?:\.(\d*))?$/.exec(v);
  if (!m) return null;
  const whole = m[1] ?? '0';
  const frac = m[2] ?? '';
  if (frac.length > decimals) return null;
  const raw = `${whole}${frac.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  return raw;
}

/** Number → plain decimal string (no exponent) with up to `decimals` digits, for prefilling inputs. */
export function plainDecimal(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '0';
  const fixed = value.toFixed(decimals);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** `^\d+(\.\d{1,2})?$` amount typed by a person (dot or comma as decimal separator). */
export function parseAmount(input: string, maxDecimals = 2): number | null {
  const v = input.trim().replace(',', '.');
  const re = new RegExp(String.raw`^\d+(\.\d{1,${maxDecimals}})?$`);
  if (!re.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------- Owner-wallet commands (near-cli-rs, see docs/guides/MAINNET.md) ----------

export type OwnerCommandId = 'unpause' | 'setLimits' | 'withdraw' | 'setAgent';

interface CommandContext {
  owner: string;
  treasury: string;
}

const signAs = ({ owner }: CommandContext) => `sign-as ${owner} network-config mainnet sign-with-keychain send`;

const call = (ctx: CommandContext, method: string, args: string, gas = '30 Tgas') =>
  `near contract call-function as-transaction ${ctx.treasury} ${method} json-args '${args}' prepaid-gas '${gas}' attached-deposit '1 yoctoNEAR' ${signAs(ctx)}`;

export const unpauseCommand = (ctx: CommandContext) => call(ctx, 'unpause', '{}');

/** Limits in base units (6 decimals). */
export const setLimitsCommand = (ctx: CommandContext, maxPerPaymentRaw: string, dailyLimitRaw: string) =>
  call(ctx, 'set_limits', JSON.stringify({ max_per_payment: maxPerPaymentRaw, daily_limit: dailyLimitRaw }));

export const withdrawCommand = (ctx: CommandContext, receiver: string, amountRaw: string) =>
  call(ctx, 'withdraw', JSON.stringify({ receiver_id: receiver, amount: amountRaw }), '100 Tgas');

export const setAgentCommand = (ctx: CommandContext, agent: string) => call(ctx, 'set_agent', JSON.stringify({ agent_id: agent }));

export const INSTALL_CLI_COMMAND = 'npm install -g near-cli-rs';
export const IMPORT_ACCOUNT_COMMAND = 'near account import-account';
