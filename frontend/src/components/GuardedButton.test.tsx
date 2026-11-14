import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderRoutes, signInAs, USERS } from '../test/utils';
import { RunAgentButton } from './RunAgentButton';

function renderButton(mode: 'Plan' | 'RedTeamDrill' = 'Plan') {
  return renderRoutes(
    [
      { path: '/', element: <RunAgentButton mode={mode} /> },
      { path: '/agent/:runId', element: <p>Run detail</p> },
    ],
    '/',
  );
}

describe('role-guarded actions', () => {
  it('disables "Run agent now" for an Auditor and explains which role is required', async () => {
    signInAs('Auditor');
    server.use(http.get('*/api/auth/me', () => HttpResponse.json(USERS.Auditor)));
    const user = userEvent.setup();
    renderButton();
    const button = screen.getByTestId('run-agent-button');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Requires the Owner role (you are Auditor).');
    // Clicking must not call the API (MSW fails the test on any unhandled request).
    await user.click(button);
    expect(screen.queryByText('Run detail')).not.toBeInTheDocument();
  });

  it('lets an Owner start a red-team drill and opens the run', async () => {
    signInAs('Owner');
    let body: unknown = null;
    server.use(
      http.get('*/api/auth/me', () => HttpResponse.json(USERS.Owner)),
      http.post('*/api/agent/runs', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { id: 'run-9', trigger: 'RedTeamDrill', status: 'Running', startedAt: '2026-11-13T12:00:00Z', finishedAt: null, model: null, summary: null, proposed: 0, allowed: 0, needsApproval: 0, blocked: 0 },
          { status: 202 },
        );
      }),
      http.get('*/api/agent/runs', () => HttpResponse.json([])),
      http.get('*/api/dashboard', () => HttpResponse.json({})),
    );
    const user = userEvent.setup();
    const { router } = renderButton('RedTeamDrill');
    const button = screen.getByTestId('run-drill');
    expect(button).not.toHaveAttribute('aria-disabled');
    await user.click(button);
    expect(await screen.findByText('Run detail')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/agent/run-9');
    expect(body).toEqual({ mode: 'RedTeamDrill' });
  });
});
