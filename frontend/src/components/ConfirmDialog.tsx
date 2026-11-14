import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Button, type ButtonVariant } from './ui/Button';
import { Dialog } from './ui/Dialog';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  /** What will happen, in plain words. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  icon?: LucideIcon;
  variant?: Extract<ButtonVariant, 'primary' | 'danger'>;
  loading?: boolean;
  testId?: string;
}

/** "Are you sure?" before anything that moves or blocks money. The safe choice is the default focus. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel,
  cancelLabel,
  icon,
  variant = 'primary',
  loading = false,
  testId,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      testId={testId}
      footer={
        <>
          <Button onClick={onClose} data-testid={testId ? `${testId}-cancel` : undefined}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button variant={variant} icon={icon} loading={loading} onClick={onConfirm} data-testid={testId ? `${testId}-confirm` : undefined}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">{children}</div>
    </Dialog>
  );
}
