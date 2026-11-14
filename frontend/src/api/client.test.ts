import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getToken, loadSession, saveSession } from '../auth/storage';
import { server } from '../test/server';
import { USERS } from '../test/utils';
import { api, ApiError, setUnauthorizedHandler } from './client';
import { endpoints } from './endpoints';

const problem = (status: number, title: string, extra: object = {}) =>
  HttpResponse.json({ type: 'about:blank', title, status, ...extra }, { status, headers: { 'Content-Type': 'application/problem+json' } });

describe('API client', () => {
  afterEach(() => {
    setUnauthorizedHandler(null);
    clearSession();
  });

  it('sends the bearer token', async () => {
    saveSession({ token: 'abc123', user: USERS.Owner, expiresAt: null });
    let auth: string | null = null;
    server.use(
      http.get('*/api/settings', ({ request }) => {
        auth = request.headers.get('authorization');
        return HttpResponse.json({ organizationName: 'Demo', treasuryAccountId: null, executionMode: 'Simulation', network: 'mainnet' });
      }),
    );
    const settings = await endpoints.settings();
    expect(settings.executionMode).toBe('Simulation');
    expect(auth).toBe('Bearer abc123');
  });

  it('on 401 clears the session, fires the logout handler and throws ApiError', async () => {
    saveSession({ token: 'expired', user: USERS.Approver, expiresAt: null });
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    server.use(http.get('*/api/dashboard', () => problem(401, 'Unauthorized')));

    const err = await endpoints.dashboard().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(getToken()).toBeNull();
    expect(loadSession()).toBeNull();
  });

  it('does not log out when the login call itself returns 401 (bad credentials)', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    server.use(http.post('*/api/auth/login', () => problem(401, 'Invalid credentials')));
    const err = await endpoints.login({ email: 'x@y.z', password: 'nope' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('keeps the session on 403 and exposes ProblemDetails + field errors', async () => {
    saveSession({ token: 't', user: USERS.Auditor, expiresAt: null });
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    server.use(
      http.post('*/api/bills', () =>
        problem(400, 'Validation failed', { detail: 'One or more fields are invalid.', errors: { AmountUsd: ['Must be positive.'] } }),
      ),
      http.post('*/api/agent/runs', () => problem(403, 'Forbidden')),
    );
    const validation = (await api('/api/bills', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(validation.status).toBe(400);
    expect(validation.message).toBe('One or more fields are invalid.');
    expect(validation.fieldErrors).toEqual({ amountUsd: 'Must be positive.' });

    const forbidden = (await endpoints.runAgent().catch((e: unknown) => e)) as ApiError;
    expect(forbidden.status).toBe(403);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(getToken()).toBe('t');
  });

  it('sends the run mode for red-team drills', async () => {
    saveSession({ token: 't', user: USERS.Owner, expiresAt: null });
    let body: unknown = null;
    server.use(
      http.post('*/api/agent/runs', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { id: 'r1', trigger: 'RedTeamDrill', status: 'Running', startedAt: '2026-11-13T12:00:00Z', finishedAt: null, model: null, summary: null, proposed: 0, allowed: 0, needsApproval: 0, blocked: 0 },
          { status: 202 },
        );
      }),
    );
    const run = await endpoints.runAgent('RedTeamDrill');
    expect(body).toEqual({ mode: 'RedTeamDrill' });
    expect(run.trigger).toBe('RedTeamDrill');
  });

  it('drops expired stored sessions', () => {
    saveSession({ token: 'old', user: USERS.Owner, expiresAt: '2020-01-01T00:00:00Z' });
    expect(loadSession()).toBeNull();
    expect(getToken()).toBeNull();
  });
});
