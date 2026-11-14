import { describe, expect, it } from 'vitest';
import type { Role } from '../api/types';
import { can, PERMISSIONS, requiredRole, type Permission } from './permissions';

// Expected matrix straight from docs/api/CONTRACT.md.
const EXPECTED: Record<Role, Permission[]> = {
  Owner: [...PERMISSIONS],
  Approver: ['bills.create', 'bills.edit', 'bills.extract', 'payments.approve', 'payments.export', 'audit.read'],
  Auditor: ['payments.export', 'audit.read'],
};

describe('can()', () => {
  for (const role of Object.keys(EXPECTED) as Role[]) {
    it(`grants ${role} exactly its contract permissions`, () => {
      const granted = PERMISSIONS.filter((p) => can(role, p));
      expect([...granted].sort()).toEqual([...EXPECTED[role]].sort());
    });
  }

  it('denies everything without a role', () => {
    expect(PERMISSIONS.some((p) => can(null, p))).toBe(false);
    expect(PERMISSIONS.some((p) => can(undefined, p))).toBe(false);
  });

  it('keeps owner-only actions away from Approver and Auditor', () => {
    for (const p of ['agent.run', 'policy.edit', 'payees.manage', 'settings.edit', 'bills.cancel', 'payments.deposit', 'users.manage', 'demo.reset', 'treasury.manage'] as const) {
      expect(can('Approver', p)).toBe(false);
      expect(can('Auditor', p)).toBe(false);
      expect(requiredRole(p)).toBe('Owner');
    }
  });

  it('reports the least-privileged role for a permission', () => {
    expect(requiredRole('payments.approve')).toBe('Approver');
    expect(requiredRole('payments.export')).toBe('Auditor');
  });
});
