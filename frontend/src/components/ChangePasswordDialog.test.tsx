import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { ChangePasswordRequest } from '../api/types';
import { meHandler, problem } from '../test/fixtures';
import { server } from '../test/server';
import { renderRoutes, signInAs, USERS } from '../test/utils';
import { UserMenu } from './layout/Chrome';

function setup() {
  signInAs('Approver');
  const received: ChangePasswordRequest[] = [];
  server.use(
    meHandler(USERS.Approver),
    http.post('*/api/auth/change-password', async ({ request }) => {
      received.push((await request.json()) as ChangePasswordRequest);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  renderRoutes([{ path: '/', element: <UserMenu /> }], '/');
  return { received };
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId('user-menu-trigger'));
  await user.click(screen.getByTestId('change-password-button'));
  return screen.findByTestId('change-password-dialog');
}

describe('change password', () => {
  it('validates current password, 12-char minimum and confirmation before calling the API', async () => {
    const user = userEvent.setup();
    const { received } = setup();
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByTestId('change-password-submit'));
    expect(within(dialog).getByText('Enter your current password.')).toBeInTheDocument();
    expect(within(dialog).getByText('Use at least 12 characters.')).toBeInTheDocument();

    await user.type(within(dialog).getByTestId('change-password-current'), 'Old-password-2026');
    await user.type(within(dialog).getByTestId('change-password-new'), 'New-password-2026');
    await user.type(within(dialog).getByTestId('change-password-confirm'), 'New-password-2027');
    await user.click(within(dialog).getByTestId('change-password-submit'));
    expect(within(dialog).getByText('The passwords do not match.')).toBeInTheDocument();

    await user.clear(within(dialog).getByTestId('change-password-new'));
    await user.type(within(dialog).getByTestId('change-password-new'), 'Old-password-2026');
    await user.click(within(dialog).getByTestId('change-password-submit'));
    expect(within(dialog).getByText('Choose a password different from the current one.')).toBeInTheDocument();
    expect(received).toHaveLength(0);
  });

  it('changes the password and confirms with a toast', async () => {
    const user = userEvent.setup();
    const { received } = setup();
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByTestId('change-password-current'), 'Old-password-2026');
    await user.type(within(dialog).getByTestId('change-password-new'), 'New-password-2026!');
    await user.type(within(dialog).getByTestId('change-password-confirm'), 'New-password-2026!');
    await user.click(within(dialog).getByTestId('change-password-submit'));

    await waitFor(() => expect(received).toEqual([{ currentPassword: 'Old-password-2026', newPassword: 'New-password-2026!' }]));
    expect(await screen.findByText('Password changed')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('change-password-submit')).not.toBeInTheDocument());
  });

  it('shows the server message when the current password is wrong (400)', async () => {
    const user = userEvent.setup();
    setup();
    server.use(http.post('*/api/auth/change-password', () => problem(400, 'The current password is incorrect.')));
    const dialog = await openDialog(user);
    await user.type(within(dialog).getByTestId('change-password-current'), 'Wrong-password-1');
    await user.type(within(dialog).getByTestId('change-password-new'), 'New-password-2026!');
    await user.type(within(dialog).getByTestId('change-password-confirm'), 'New-password-2026!');
    await user.click(within(dialog).getByTestId('change-password-submit'));
    expect(await within(dialog).findByTestId('change-password-error')).toHaveTextContent('The current password is incorrect.');
  });
});
