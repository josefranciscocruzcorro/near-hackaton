import type { MouseEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { requiredRole, type Permission } from '../auth/permissions';
import { useI18n } from '../i18n';
import { Button, type ButtonProps } from './ui/Button';
import { Tooltip } from './ui/Tooltip';

interface GuardedButtonProps extends ButtonProps {
  permission: Permission;
  /** Extra reason that blocks the action even when the role allows it. */
  blockedReason?: string | null;
}

/**
 * A button for a role-restricted action. When the current role cannot perform it the button stays
 * visible and focusable but `aria-disabled`, and a tooltip explains which role is required — so the
 * UI is coherent with the API's 403 rules.
 */
export function GuardedButton({ permission, blockedReason, onClick, ...rest }: GuardedButtonProps) {
  const { can, role } = useAuth();
  const { t } = useI18n();
  const allowed = can(permission);
  const reason = !allowed
    ? t('perm.requires', { role: t(`role.${requiredRole(permission)}`), current: role ? t(`role.${role}`) : '—' })
    : blockedReason ?? null;

  if (!reason) return <Button onClick={onClick} {...rest} />;

  const block = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  };
  return (
    <Tooltip content={reason}>
      {(id) => <Button {...rest} aria-disabled="true" aria-describedby={id} onClick={block} data-blocked="true" />}
    </Tooltip>
  );
}
