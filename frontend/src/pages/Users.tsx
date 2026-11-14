import { CircleCheckBig, CircleSlash, FileSearch, KeyRound, Lock, Pencil, ShieldCheck, UserCog, UserPlus, Users as UsersIcon } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { ApiError } from '../api/client';
import { useCreateUser, useResetUserPassword, useUpdateUser, useUsers } from '../api/queries';
import { MIN_PASSWORD_LENGTH, ROLES, type Role, type UserAdmin } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { GuardedButton } from '../components/GuardedButton';
import { PasswordField } from '../components/PasswordField';
import { QueryView } from '../components/QueryView';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { Dialog } from '../components/ui/Dialog';
import { SelectField, SwitchField, TextField } from '../components/ui/Field';
import { PageHeader } from '../components/ui/Misc';
import { EmptyState } from '../components/ui/States';
import { useToast } from '../components/ui/Toast';
import { useI18n, type TFunction } from '../i18n';
import { formatDate } from '../lib/format';
import type { Tone } from '../lib/status';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_VISUAL: Record<Role, { tone: Tone; icon: typeof UserCog }> = {
  Owner: { tone: 'success', icon: UserCog },
  Approver: { tone: 'info', icon: ShieldCheck },
  Auditor: { tone: 'neutral', icon: FileSearch },
};

function RoleChip({ role }: { role: Role }) {
  const { t } = useI18n();
  const v = ROLE_VISUAL[role];
  return (
    <Chip tone={v.tone} icon={v.icon} testId="user-role-chip">
      {t(`role.${role}`)}
    </Chip>
  );
}

function ActiveChip({ active }: { active: boolean }) {
  const { t } = useI18n();
  return active ? (
    <Chip tone="success" icon={CircleCheckBig} testId="user-active-chip">
      {t('users.active')}
    </Chip>
  ) : (
    <Chip tone="neutral" icon={CircleSlash} testId="user-active-chip">
      {t('users.inactive')}
    </Chip>
  );
}

/** Server message for a failed save; 409 carries the business rule (last Owner, self-demotion, duplicate email). */
function saveErrorMessage(err: Error, t: TFunction): string {
  if (err instanceof ApiError && err.status === 409) return err.problem?.detail ?? err.message;
  return err.message || t('error.generic');
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" data-testid="user-form-error" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-medium text-danger sm:col-span-2">
      {message}
    </p>
  );
}

function RoleSelect({ value, onChange, error }: { value: Role; onChange: (r: Role) => void; error?: string }) {
  const { t } = useI18n();
  return (
    <SelectField
      label={t('users.role')}
      required
      value={value}
      error={error}
      hint={t(`role.${value}.desc`)}
      onChange={(e) => onChange(e.target.value as Role)}
      data-testid="user-role-select"
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {t(`role.${r}`)}
        </option>
      ))}
    </SelectField>
  );
}

// ---------- Invite ----------

interface InviteForm {
  email: string;
  name: string;
  role: Role;
  password: string;
}
type InviteErrors = Partial<Record<keyof InviteForm, string>>;

export function validateInvite(f: InviteForm, t: TFunction): InviteErrors {
  const e: InviteErrors = {};
  if (!EMAIL.test(f.email.trim())) e.email = t('validation.email');
  if (!f.name.trim()) e.name = t('validation.nameRequired');
  else if (f.name.trim().length > 120) e.name = t('validation.tooLong', { max: 120 });
  if (f.password.length < MIN_PASSWORD_LENGTH) e.password = t('validation.passwordLength', { min: MIN_PASSWORD_LENGTH });
  return e;
}

function InviteUserDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const create = useCreateUser();
  const [form, setForm] = useState<InviteForm>({ email: '', name: '', role: 'Approver', password: '' });
  const [errors, setErrors] = useState<InviteErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = <K extends keyof InviteForm>(k: K, v: InviteForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    const v = validateInvite(form, t);
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    create.mutate(
      { email: form.email.trim(), name: form.name.trim(), role: form.role, password: form.password },
      {
        onSuccess: (u) => {
          toast({ title: t('users.invited'), description: t('users.invitedBody', { email: u.email }), tone: 'success', duration: 8000 });
          onClose();
        },
        onError: (err) => {
          if (err instanceof ApiError) setErrors(err.fieldErrors);
          setFormError(saveErrorMessage(err, t));
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('users.invite')}
      description={t('users.inviteHint')}
      testId="invite-user-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="invite-user-form" variant="primary" icon={UserPlus} loading={create.isPending} data-testid="user-form-submit">
            {t('users.inviteSubmit')}
          </Button>
        </>
      }
    >
      <form id="invite-user-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t('login.email')}
          type="email"
          inputMode="email"
          required
          value={form.email}
          error={errors.email}
          onChange={(e) => set('email', e.target.value)}
          autoComplete="off"
          data-testid="user-email"
        />
        <TextField label={t('users.name')} required value={form.name} error={errors.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" data-testid="user-name" />
        <div className="sm:col-span-2">
          <RoleSelect value={form.role} onChange={(r) => set('role', r)} error={errors.role} />
        </div>
        <PasswordField
          label={t('users.tempPassword')}
          required
          showStrength
          generator
          value={form.password}
          onValueChange={(v) => set('password', v)}
          error={errors.password}
          autoComplete="new-password"
          containerClassName="sm:col-span-2"
          testId="user-password"
        />
        <p className="text-xs text-muted sm:col-span-2">{t('users.tempPasswordHint')}</p>
        <FormError message={formError} />
      </form>
    </Dialog>
  );
}

// ---------- Edit ----------

function EditUserDialog({ user, onClose }: { user: UserAdmin; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user: me } = useAuth();
  const update = useUpdateUser();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const isSelf = me?.id === user.id;

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    const v: Record<string, string> = {};
    if (!name.trim()) v.name = t('validation.nameRequired');
    else if (name.trim().length > 120) v.name = t('validation.tooLong', { max: 120 });
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    update.mutate(
      { id: user.id, input: { name: name.trim(), role, isActive } },
      {
        onSuccess: (u) => {
          toast({ title: t('users.updated'), description: u.name, tone: 'success' });
          onClose();
        },
        onError: (err) => {
          if (err instanceof ApiError) setErrors(err.fieldErrors);
          setFormError(saveErrorMessage(err, t));
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('users.edit')}
      description={user.email}
      testId="edit-user-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="edit-user-form" variant="primary" loading={update.isPending} data-testid="user-form-submit">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="edit-user-form" onSubmit={submit} noValidate className="grid gap-4">
        <TextField label={t('users.name')} required value={name} error={errors.name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-testid="user-name" />
        <RoleSelect value={role} onChange={setRole} error={errors.role} />
        <SwitchField
          label={t('users.active')}
          hint={isActive ? t('users.activeHint') : t('users.inactiveHint')}
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          data-testid="user-active-toggle"
        />
        {isSelf ? <p className="text-xs text-muted">{t('users.selfHint')}</p> : null}
        <FormError message={formError} />
      </form>
    </Dialog>
  );
}

// ---------- Reset password ----------

function ResetPasswordDialog({ user, onClose }: { user: UserAdmin; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const reset = useResetUserPassword();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('validation.passwordLength', { min: MIN_PASSWORD_LENGTH }));
      return;
    }
    setError(null);
    reset.mutate(
      { id: user.id, newPassword: password },
      {
        onSuccess: () => {
          toast({ title: t('users.passwordReset'), description: t('users.passwordResetBody', { name: user.name }), tone: 'success', duration: 8000 });
          onClose();
        },
        onError: (err) => {
          if (err instanceof ApiError) setError(err.fieldErrors.newPassword ?? null);
          setFormError(saveErrorMessage(err, t));
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={t('users.resetPassword')}
      description={t('users.resetPasswordHint', { name: user.name })}
      testId="reset-password-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="reset-password-form" variant="primary" icon={KeyRound} loading={reset.isPending} data-testid="reset-password-submit">
            {t('users.resetPassword')}
          </Button>
        </>
      }
    >
      <form id="reset-password-form" onSubmit={submit} noValidate className="grid gap-4">
        <PasswordField
          label={t('users.tempPassword')}
          required
          showStrength
          generator
          value={password}
          onValueChange={setPassword}
          error={error}
          autoComplete="new-password"
          testId="reset-password-input"
        />
        <p className="text-xs text-muted">{t('users.tempPasswordHint')}</p>
        <FormError message={formError} />
      </form>
    </Dialog>
  );
}

// ---------- Page ----------

type Editing = { kind: 'invite' } | { kind: 'edit'; user: UserAdmin } | { kind: 'reset'; user: UserAdmin } | null;

function OwnerOnly() {
  const { t } = useI18n();
  const { role } = useAuth();
  return (
    <Card data-testid="users-owner-only">
      <EmptyState
        icon={Lock}
        title={t('users.ownerOnly')}
        description={t('perm.requires', { role: t('role.Owner'), current: role ? t(`role.${role}`) : '—' })}
      />
    </Card>
  );
}

function UserActions({ user, onEdit, onReset }: { user: UserAdmin; onEdit: () => void; onReset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" icon={Pencil} onClick={onEdit} aria-label={t('users.editNamed', { name: user.name })} data-testid="edit-user-button">
        <span className="hidden xl:inline">{t('common.edit')}</span>
      </Button>
      <Button size="sm" variant="ghost" icon={KeyRound} onClick={onReset} aria-label={t('users.resetNamed', { name: user.name })} data-testid="reset-password-button">
        <span className="hidden xl:inline">{t('users.resetPasswordShort')}</span>
      </Button>
    </div>
  );
}

function UsersList({ users, onEdit, onReset }: { users: UserAdmin[]; onEdit: (u: UserAdmin) => void; onReset: (u: UserAdmin) => void }) {
  const { t, locale } = useI18n();
  const { user: me } = useAuth();
  const you = (u: UserAdmin) =>
    u.id === me?.id ? (
      <Chip tone="info" className="ml-1.5 align-middle">
        {t('users.you')}
      </Chip>
    ) : null;

  if (users.length === 0) {
    return (
      <Card>
        <EmptyState icon={UsersIcon} title={t('users.empty')} />
      </Card>
    );
  }

  return (
    <>
      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('users.title')}</caption>
          <thead className="border-b border-border bg-surface-2/60 text-left text-xs text-muted">
            <tr>
              <th scope="col" className="w-[45%] px-4 py-2.5 font-medium">{t('users.name')}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{t('users.role')}</th>
              <th scope="col" className="px-4 py-2.5 font-medium">{t('common.status')}</th>
              <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">{t('users.created')}</th>
              <th scope="col" className="px-4 py-2.5">
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-surface-2/40" data-testid="users-row" data-active={u.isActive}>
                <td className="max-w-0 px-4 py-3">
                  <p className="truncate font-medium">
                    {u.name}
                    {you(u)}
                  </p>
                  <p className="truncate text-xs text-muted">{u.email}</p>
                </td>
                <td className="px-4 py-3">
                  <RoleChip role={u.role} />
                </td>
                <td className="px-4 py-3">
                  <ActiveChip active={u.isActive} />
                </td>
                <td className="hidden px-4 py-3 text-xs text-muted lg:table-cell">{formatDate(u.createdAt, locale)}</td>
                <td className="px-4 py-3">
                  <UserActions user={u} onEdit={() => onEdit(u)} onReset={() => onReset(u)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <ul className="space-y-3 md:hidden">
        {users.map((u) => (
          <li key={u.id} className="rounded-[10px] border border-border bg-surface p-4" data-testid="users-card" data-active={u.isActive}>
            <div className="min-w-0">
              <p className="truncate font-medium">
                {u.name}
                {you(u)}
              </p>
              <p className="truncate text-xs text-muted">{u.email}</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <RoleChip role={u.role} />
              <ActiveChip active={u.isActive} />
              <span className="text-xs text-muted">{t('users.createdOn', { date: formatDate(u.createdAt, locale) })}</span>
            </div>
            <div className="mt-2 -mr-2">
              <UserActions user={u} onEdit={() => onEdit(u)} onReset={() => onReset(u)} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function UsersPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const allowed = can('users.manage');
  const query = useUsers(allowed);
  const [editing, setEditing] = useState<Editing>(null);
  const close = () => setEditing(null);

  return (
    <>
      <PageHeader
        title={t('users.title')}
        description={t('users.subtitle')}
        actions={
          <GuardedButton permission="users.manage" variant="primary" icon={UserPlus} onClick={() => setEditing({ kind: 'invite' })} data-testid="invite-user-button">
            {t('users.invite')}
          </GuardedButton>
        }
      />
      {allowed ? (
        <QueryView query={query}>
          {(users) => (
            <UsersList
              users={users}
              onEdit={(user) => setEditing({ kind: 'edit', user })}
              onReset={(user) => setEditing({ kind: 'reset', user })}
            />
          )}
        </QueryView>
      ) : (
        <OwnerOnly />
      )}
      {editing?.kind === 'invite' ? <InviteUserDialog onClose={close} /> : null}
      {editing?.kind === 'edit' ? <EditUserDialog key={editing.user.id} user={editing.user} onClose={close} /> : null}
      {editing?.kind === 'reset' ? <ResetPasswordDialog key={editing.user.id} user={editing.user} onClose={close} /> : null}
    </>
  );
}
