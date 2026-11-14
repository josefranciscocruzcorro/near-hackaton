import type { Role } from '../api/types';

/**
 * Role permissions, exactly as docs/api/CONTRACT.md defines them:
 * - Owner: everything.
 * - Approver: create/edit bills, AI extraction, approve/reject payments, read everything.
 * - Auditor: read-only + CSV export + audit log.
 * Reading (dashboard, lists, audit) and CSV export are allowed for every role.
 * User administration, the demo reset and creating/funding the on-chain treasury are Owner-only.
 */
export const PERMISSIONS = [
  'bills.create',
  'bills.edit',
  'bills.extract',
  'bills.cancel',
  'payments.approve',
  'payments.deposit',
  'payments.export',
  'payees.manage',
  'policy.edit',
  'agent.run',
  'settings.edit',
  'treasury.manage',
  'users.manage',
  'demo.reset',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const APPROVER: ReadonlySet<Permission> = new Set<Permission>([
  'bills.create',
  'bills.edit',
  'bills.extract',
  'payments.approve',
  'payments.export',
  'audit.read',
]);

const AUDITOR: ReadonlySet<Permission> = new Set<Permission>(['payments.export', 'audit.read']);

export function can(role: Role | null | undefined, permission: Permission): boolean {
  switch (role) {
    case 'Owner':
      return true;
    case 'Approver':
      return APPROVER.has(permission);
    case 'Auditor':
      return AUDITOR.has(permission);
    default:
      return false;
  }
}

/** The least-privileged role that holds a permission, used to explain disabled actions. */
export function requiredRole(permission: Permission): Role {
  if (can('Auditor', permission)) return 'Auditor';
  if (can('Approver', permission)) return 'Approver';
  return 'Owner';
}
