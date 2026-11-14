import { KeyRound } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { ApiError } from '../api/client';
import { useChangePassword } from '../api/queries';
import { MIN_PASSWORD_LENGTH } from '../api/types';
import { useI18n, type TFunction } from '../i18n';
import { PasswordField } from './PasswordField';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { useToast } from './ui/Toast';

export interface ChangePasswordForm {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

export type ChangePasswordErrors = Partial<Record<keyof ChangePasswordForm, string>>;

export function validateChangePassword(f: ChangePasswordForm, t: TFunction): ChangePasswordErrors {
  const e: ChangePasswordErrors = {};
  if (!f.currentPassword) e.currentPassword = t('validation.currentPasswordRequired');
  if (f.newPassword.length < MIN_PASSWORD_LENGTH) e.newPassword = t('validation.passwordLength', { min: MIN_PASSWORD_LENGTH });
  else if (f.newPassword === f.currentPassword) e.newPassword = t('validation.passwordSame');
  if (f.confirm !== f.newPassword) e.confirm = t('validation.passwordMismatch');
  return e;
}

const EMPTY: ChangePasswordForm = { currentPassword: '', newPassword: '', confirm: '' };

function ChangePasswordBody({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const change = useChangePassword();
  const [form, setForm] = useState<ChangePasswordForm>(EMPTY);
  const [errors, setErrors] = useState<ChangePasswordErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const set = (k: keyof ChangePasswordForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setServerError(null);
    const v = validateChangePassword(form, t);
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    change.mutate(
      { currentPassword: form.currentPassword, newPassword: form.newPassword },
      {
        onSuccess: () => {
          toast({ title: t('password.changed'), tone: 'success' });
          onClose();
        },
        onError: (err) => {
          const fields = err instanceof ApiError ? err.fieldErrors : {};
          setErrors({ currentPassword: fields.currentPassword, newPassword: fields.newPassword });
          setServerError(err.message);
        },
      },
    );
  };

  return (
    <form id="change-password-form" onSubmit={submit} noValidate className="space-y-4">
      <PasswordField
        label={t('password.current')}
        required
        value={form.currentPassword}
        onValueChange={(v) => set('currentPassword', v)}
        error={errors.currentPassword}
        autoComplete="current-password"
        testId="change-password-current"
      />
      <PasswordField
        label={t('password.new')}
        required
        showStrength
        value={form.newPassword}
        onValueChange={(v) => set('newPassword', v)}
        error={errors.newPassword}
        autoComplete="new-password"
        testId="change-password-new"
      />
      <PasswordField
        label={t('password.confirm')}
        required
        value={form.confirm}
        onValueChange={(v) => set('confirm', v)}
        error={errors.confirm}
        autoComplete="new-password"
        testId="change-password-confirm"
      />
      {serverError ? (
        <p role="alert" className="text-sm font-medium text-danger" data-testid="change-password-error">
          {serverError}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" icon={KeyRound} loading={change.isPending} data-testid="change-password-submit">
          {t('password.change')}
        </Button>
      </div>
    </form>
  );
}

/** "Change password" for the signed-in user (POST /api/auth/change-password). */
export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} size="sm" title={t('password.change')} description={t('password.changeHint')} testId="change-password-dialog">
      {/* Body is mounted only while open, so the fields reset every time. */}
      {open ? <ChangePasswordBody onClose={onClose} /> : null}
    </Dialog>
  );
}
