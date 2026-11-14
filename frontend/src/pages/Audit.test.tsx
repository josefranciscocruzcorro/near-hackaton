import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { AuditEntry } from '../api/types';
import { server } from '../test/server';
import { renderRoutes, signInAs, USERS } from '../test/utils';
import { AuditPage } from './Audit';

const events: AuditEntry[] = [
  {
    id: 'a1',
    at: '2026-11-13T21:00:00Z',
    actor: 'system',
    actorType: 'System',
    action: 'demo.seeded',
    entityType: 'Organization',
    entityId: null,
    summary: 'Demo data created.',
  },
  {
    id: 'a2',
    at: '2026-11-13T21:05:00Z',
    actor: 'approver@tesorero.demo',
    actorType: 'User',
    action: 'payment.approved',
    entityType: 'Payment',
    entityId: '5352617d-b546-499d-a647-5c7c5781e0e4',
    summary: 'Approved paying María López Studio $1,850.00.',
  },
];

describe('audit log', () => {
  it('renders events without an entity id (regression: page used to crash)', async () => {
    signInAs('Auditor');
    server.use(
      http.get('*/api/auth/me', () => HttpResponse.json(USERS.Auditor)),
      http.get('*/api/audit', () => HttpResponse.json(events)),
    );

    renderRoutes([{ path: '/audit', element: <AuditPage /> }], '/audit');

    expect(await screen.findByText('Demo data created.')).toBeInTheDocument();
    expect(screen.getByText(/Approved paying María López Studio/)).toBeInTheDocument();
    expect(screen.getAllByTestId('audit-entry')).toHaveLength(2);
    expect(screen.getByText('5352617d…')).toBeInTheDocument();
  });
});
