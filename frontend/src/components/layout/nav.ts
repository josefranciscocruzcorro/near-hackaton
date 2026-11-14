import {
  Bot,
  CreditCard,
  FileText,
  Inbox,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  Vault,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '../../auth/permissions';
import type { TranslationKey } from '../../i18n';

export interface NavItem {
  id: string;
  to: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
  /** Shows the pending-approvals counter. */
  badge?: boolean;
  /** Hidden from navigation for roles without this permission (admin-only pages). */
  permission?: Permission;
  /** Extra search words for the command palette (both languages). */
  keywords?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'overview', to: '/', labelKey: 'nav.overview', icon: LayoutDashboard },
  { id: 'bills', to: '/bills', labelKey: 'nav.bills', icon: FileText },
  { id: 'approvals', to: '/approvals', labelKey: 'nav.approvals', icon: Inbox, badge: true },
  { id: 'payments', to: '/payments', labelKey: 'nav.payments', icon: CreditCard },
  { id: 'treasury', to: '/treasury', labelKey: 'nav.treasury', icon: Vault,
    keywords: 'tesoreria fund fondear deposit depositar usdt usdc binance wallet billetera contract contrato agent agente' },
  { id: 'agent', to: '/agent', labelKey: 'nav.agent', icon: Bot },
  { id: 'payees', to: '/payees', labelKey: 'nav.payees', icon: Users },
  { id: 'policies', to: '/policies', labelKey: 'nav.policies', icon: ShieldCheck },
  { id: 'audit', to: '/audit', labelKey: 'nav.audit', icon: ScrollText },
  { id: 'users', to: '/users', labelKey: 'nav.users', icon: UserCog, permission: 'users.manage' },
  { id: 'settings', to: '/settings', labelKey: 'nav.settings', icon: Settings },
];

/** Bottom tab bar (mobile): the first four plus a "More" sheet with the rest. */
export const TAB_IDS = ['overview', 'bills', 'approvals', 'payments'] as const;
export const TAB_ITEMS = NAV_ITEMS.filter((n) => (TAB_IDS as readonly string[]).includes(n.id));
export const MORE_ITEMS = NAV_ITEMS.filter((n) => !(TAB_IDS as readonly string[]).includes(n.id));

/** Items the current role may see (pages with a `permission` are hidden from the others). */
export function visibleItems(items: NavItem[], can: (permission: Permission) => boolean): NavItem[] {
  return items.filter((n) => !n.permission || can(n.permission));
}
