import {
  Ban,
  CheckCircle2,
  CircleCheckBig,
  CircleDashed,
  CircleDot,
  CircleX,
  Clock,
  Hourglass,
  Info,
  Loader,
  OctagonX,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { AgentRunStatus, BillStatus, PaymentStatus, PolicyOutcome, PolicyReasonSeverity } from '../api/types';

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface StatusVisual {
  tone: Tone;
  icon: LucideIcon;
  /** Animated icon (in-flight states); disabled under prefers-reduced-motion by global CSS. */
  spin?: boolean;
}

export const PAYMENT_STATUS_VISUAL: Record<PaymentStatus, StatusVisual> = {
  PendingApproval: { tone: 'warning', icon: Hourglass },
  Approved: { tone: 'info', icon: CheckCircle2 },
  Blocked: { tone: 'danger', icon: OctagonX },
  Rejected: { tone: 'danger', icon: CircleX },
  AwaitingDeposit: { tone: 'warning', icon: Wallet },
  Processing: { tone: 'info', icon: Loader, spin: true },
  Settled: { tone: 'success', icon: CircleCheckBig },
  Refunded: { tone: 'neutral', icon: RotateCcw },
  Failed: { tone: 'danger', icon: TriangleAlert },
};

export const BILL_STATUS_VISUAL: Record<BillStatus, StatusVisual> = {
  Open: { tone: 'info', icon: CircleDot },
  Scheduled: { tone: 'warning', icon: Clock },
  Paid: { tone: 'success', icon: CircleCheckBig },
  Cancelled: { tone: 'neutral', icon: Ban },
};

export const RUN_STATUS_VISUAL: Record<AgentRunStatus, StatusVisual> = {
  Running: { tone: 'info', icon: CircleDashed, spin: true },
  Completed: { tone: 'success', icon: CircleCheckBig },
  Failed: { tone: 'danger', icon: TriangleAlert },
};

export const OUTCOME_VISUAL: Record<PolicyOutcome, StatusVisual> = {
  Allow: { tone: 'success', icon: ShieldCheck },
  RequireApproval: { tone: 'warning', icon: ShieldAlert },
  Block: { tone: 'danger', icon: OctagonX },
};

export const SEVERITY_VISUAL: Record<PolicyReasonSeverity, StatusVisual> = {
  info: { tone: 'info', icon: Info },
  warn: { tone: 'warning', icon: TriangleAlert },
  block: { tone: 'danger', icon: OctagonX },
};

/** Tailwind classes per tone: soft background, readable foreground, matching border. */
export const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-accent-soft text-accent-strong border-accent/30',
  warning: 'bg-warning-soft text-warning border-warning/30',
  danger: 'bg-danger-soft text-danger border-danger/30',
  info: 'bg-info-soft text-info border-info/30',
  neutral: 'bg-surface-2 text-muted border-border',
};

export const TONE_TEXT: Record<Tone, string> = {
  success: 'text-accent-strong',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
  neutral: 'text-muted',
};
