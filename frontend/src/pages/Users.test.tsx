import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { CreateUserRequest, ResetPasswordRequest, Role, UpdateUserRequest, UserAdmin } from '../api/types';
import { meHandler, problem } from '../test/fixtures';
import { server } from '../test/server';
import { renderRoutes, signInAs, USERS } from '../test/utils';
import { UsersPage } from './Users';

const LIST: UserAdmin[] = [
  { id: USERS.Owner.id, email: USERS.Owner.email, name: USERS.Owner.name, role: 'Owner', isActive: true, createdAt: '2026-11-01T10:00:00Z' },
  { id: 'u-2', email: 'bea@acme.example', name: 'Bea Approver', role: 'Approver', isActive: true, createdAt: '2026-11-02T10:00:00Z' },
  { id: 'u-3', email: 'carl@acme.example', name: 'Carl Auditor', role: 'Auditor', isActive: false, createdAt: '2026-11-03T10:00:00Z' },
];

function nth(items: HTMLElement[], i: number): HTMLElement {
  const item = items[i];
  if (!item) throw new Error(`missing item ${String(i)}`);
  return item;
}

function setup(role: Role = 'Owner') {
  signInAs(role);
  const calls = { list: 0, created: [] as CreateUserRequest[], updated: [] as { id: string; body: UpdateUserRequest }[], resets: [] as { id: string; body: ResetPasswordRequest }[] };
  server.use(
    meHandler(USERS[role]),
    http.get('*/api/users', () => {
      calls.list++;
      return HttpResponse.json(LIST);
    }),
    http.post('*/api/users', async ({ request }) => {
      const body = (await request.json()) as CreateUserRequest;
      calls.created.push(body);
      return HttpResponse.json<UserAdmin>({ id: 'u-new', email: body.email, name: body.name, role: body.role, isActive: true, createdAt: '2026-11-13T10:00:00Z' }, { status: 201 });
    }),
    http.put('*/api/users/:id/password', async ({ request, params }) => {
      calls.resets.push({ id: String(params.id), body: (await request.json()) as ResetPasswordRequest });
      return new HttpResponse(null, { status: 204 });
    }),
    http.put('*/api/users/:id', async ({ request, params }) => {
      const body = (await request.json()) as UpdateUserRequest;
      calls.updated.push({ id: String(params.id), body });
      const current = LIST.find((u) => u.id === params.id);
      return HttpResponse.json({ ...current, ...body });
    }),
  );
  const view = renderRoutes([{ path: '/users', element: <UsersPage /> }], '/users');
  return { calls, ...view };
}

describe('users admin', () => {
  it('lists users with role, active state and a "You" marker for the Owner', async () => {
    setup();
    const rows = await screen.findAllByTestId('users-row');
    expect(rows).toHaveLength(3);
    expect(within(nth(rows, 0)).getByText('You')).toBeInTheDocument();
    expect(within(nth(rows, 1)).getByTestId('user-role-chip')).toHaveTextContent('Approver');
    expect(within(nth(rows, 2)).getByTestId('user-active-chip')).toHaveTextContent('Inactive');
    expect(screen.getAllByTestId('users-card')).toHaveLength(3);
  });

  it.each(['Approver', 'Auditor'] as const)('shows a "needs Owner" state to %s and never calls the API', async (role) => {
    const { calls } = setup(role);
    expect(await screen.findByTestId('users-owner-only')).toHaveTextContent('Only an Owner can manage users');
    expect(screen.getByTestId('invite-user-button')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByTestId('users-row')).not.toBeInTheDocument();
    expect(calls.list).toBe(0);
  });

  it('invites a user with a generated strong temporary password', async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await screen.findAllByTestId('users-row');
    await user.click(screen.getByTestId('invite-user-button'));
    const dialog = await screen.findByTestId('invite-user-dialog');
    await user.type(within(dialog).getByTestId('user-email'), 'dana@acme.example');
    await user.type(within(dialog).getByTestId('user-name'), 'Dana Doe');
    await user.selectOptions(within(dialog).getByTestId('user-role-select'), 'Auditor');
    await user.click(within(dialog).getByTestId('user-password-generate'));

    const password = within(dialog).getByTestId<HTMLInputElement>('user-password').value;
    expect(password).toHaveLength(20);
    expect(within(dialog).getByTestId('user-password')).toHaveAttribute('type', 'text');
    await user.click(within(dialog).getByTestId('user-password-copy'));
    expect(await navigator.clipboard.readText()).toBe(password);

    await user.click(within(dialog).getByTestId('user-form-submit'));
    await waitFor(() => expect(calls.created).toEqual([{ email: 'dana@acme.example', name: 'Dana Doe', role: 'Auditor', password }]));
    expect(await screen.findByText('User created')).toBeInTheDocument();
  });

  it('rejects a temporary password shorter than 12 characters', async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await screen.findAllByTestId('users-row');
    await user.click(screen.getByTestId('invite-user-button'));
    const dialog = await screen.findByTestId('invite-user-dialog');
    await user.type(within(dialog).getByTestId('user-email'), 'dana@acme.example');
    await user.type(within(dialog).getByTestId('user-name'), 'Dana Doe');
    await user.type(within(dialog).getByTestId('user-password'), 'short');
    await user.click(within(dialog).getByTestId('user-form-submit'));
    expect(await within(dialog).findByText('Use at least 12 characters.')).toBeInTheDocument();
    expect(calls.created).toHaveLength(0);
  });

  it('shows the server detail when the email already exists (409)', async () => {
    const user = userEvent.setup();
    setup();
    server.use(http.post('*/api/users', () => problem(409, 'A user with this email already exists.')));
    await screen.findAllByTestId('users-row');
    await user.click(screen.getByTestId('invite-user-button'));
    const dialog = await screen.findByTestId('invite-user-dialog');
    await user.type(within(dialog).getByTestId('user-email'), 'bea@acme.example');
    await user.type(within(dialog).getByTestId('user-name'), 'Bea Again');
    await user.click(within(dialog).getByTestId('user-password-generate'));
    await user.click(within(dialog).getByTestId('user-form-submit'));
    expect(await within(dialog).findByTestId('user-form-error')).toHaveTextContent('A user with this email already exists.');
  });

  it('edits role and active state', async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    const rows = await screen.findAllByTestId('users-row');
    await user.click(within(nth(rows, 1)).getByTestId('edit-user-button'));
    const dialog = await screen.findByTestId('edit-user-dialog');
    await user.selectOptions(within(dialog).getByTestId('user-role-select'), 'Auditor');
    await user.click(within(dialog).getByTestId('user-active-toggle'));
    await user.click(within(dialog).getByTestId('user-form-submit'));
    await waitFor(() => expect(calls.updated).toEqual([{ id: 'u-2', body: { name: 'Bea Approver', role: 'Auditor', isActive: false } }]));
    await waitFor(() => expect(screen.queryByTestId('edit-user-dialog')).not.toBeInTheDocument());
  });

  it('keeps the dialog open and shows the server rule when the last Owner would be demoted (409)', async () => {
    const user = userEvent.setup();
    setup();
    server.use(http.put('*/api/users/:id', () => problem(409, 'The organization must keep at least one active Owner.')));
    const rows = await screen.findAllByTestId('users-row');
    await user.click(within(nth(rows, 0)).getByTestId('edit-user-button'));
    const dialog = await screen.findByTestId('edit-user-dialog');
    await user.selectOptions(within(dialog).getByTestId('user-role-select'), 'Approver');
    await user.click(within(dialog).getByTestId('user-form-submit'));
    expect(await within(dialog).findByTestId('user-form-error')).toHaveTextContent('The organization must keep at least one active Owner.');
    expect(screen.getByTestId('edit-user-dialog')).toBeInTheDocument();
  });

  it('resets another user password', async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    const rows = await screen.findAllByTestId('users-row');
    await user.click(within(nth(rows, 2)).getByTestId('reset-password-button'));
    const dialog = await screen.findByTestId('reset-password-dialog');
    await user.type(within(dialog).getByTestId('reset-password-input'), 'Temporary-pass-2026');
    await user.click(within(dialog).getByTestId('reset-password-submit'));
    await waitFor(() => expect(calls.resets).toEqual([{ id: 'u-3', body: { newPassword: 'Temporary-pass-2026' } }]));
    expect(await screen.findByText('Password reset')).toBeInTheDocument();
  });
});
