// Feature: workspace-authorization, Property 10: Exactly one redacted audit entry per denial
import fc from 'fast-check';

import { AuthorizationAuditService, DenialMeta } from './authorization-audit.service';
import { Action } from './permission-matrix';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Property 10 (Validates: Requirements 11.1, 11.2, 11.3).
 *
 * For ANY denial across the three outcomes — `membership_denied` (403),
 * `role_denied` (403), and `cross_tenant_denied` (404) — `recordDenial(meta, req)`:
 *
 *  - writes EXACTLY ONE `AuditLog` row (`auditLog.create` called once);
 *  - the persisted row carries the principal `userId`, the active `workspaceId`, an
 *    `action`, and the denial `outcome`; for `cross_tenant_denied` it additionally
 *    carries `resourceType` + `resourceId`, while `resourceId` is `null` for the
 *    non-cross-tenant outcomes (Req 11.1, 11.2);
 *  - the row contains NO decrypted token / secret / resource field value: the service
 *    derives the row only from `meta` + the request method/route and NEVER reads the
 *    request body, so a secret planted in `req.body` can never reach the log (Req 11.3).
 *
 * The service is driven directly with a fake `PrismaService` whose `auditLog.create`
 * is a `jest.fn()` capturing the persisted `data`, so the test stays fast and
 * deterministic without a database.
 */
describe('AuthorizationAuditService.recordDenial — Property 10: exactly one redacted audit entry per denial', () => {
  // A token-like secret planted in the request body. It must NEVER appear in the
  // persisted audit row, proving the service ignores the request body (Req 11.3).
  const SECRET = 'SECRET_TOKEN_XYZ';

  const ACTIONS: Action[] = [
    'content.create',
    'content.update',
    'content.delete',
    'post.publish',
    'approval.review',
    'social.connect',
    'social.disconnect',
  ];

  // Non-empty identifier-ish strings for ids / resource fields.
  const idArb = fc.string({ minLength: 1, maxLength: 24 });

  // The three denial outcomes as typed `DenialMeta` values. `userId` is always
  // supplied so we can assert the row carries the principal identity for each.
  const metaArb: fc.Arbitrary<DenialMeta> = fc.oneof(
    fc.record({ userId: idArb, workspaceId: idArb }).map(
      ({ userId, workspaceId }): DenialMeta => ({
        userId,
        workspaceId,
        outcome: 'membership_denied',
      }),
    ),
    fc
      .record({
        userId: idArb,
        workspaceId: idArb,
        action: fc.constantFrom<Action>(...ACTIONS),
      })
      .map(
        ({ userId, workspaceId, action }): DenialMeta => ({
          userId,
          workspaceId,
          action,
          outcome: 'role_denied',
        }),
      ),
    fc
      .record({
        userId: idArb,
        workspaceId: idArb,
        resourceType: idArb,
        resourceId: idArb,
      })
      .map(
        ({ userId, workspaceId, resourceType, resourceId }): DenialMeta => ({
          userId,
          workspaceId,
          resourceType,
          resourceId,
          outcome: 'cross_tenant_denied',
        }),
      ),
  );

  // A request carrying a token-like secret in its body plus arbitrary method/route
  // info (the only fields the service is allowed to read).
  const reqArb = fc
    .record({
      method: fc.constantFrom('GET', 'POST', 'PUT', 'PATCH', 'DELETE', ''),
      path: fc.option(fc.string({ maxLength: 24 }), { nil: undefined }),
      url: fc.option(fc.string({ maxLength: 24 }), { nil: undefined }),
    })
    .map(({ method, path, url }) => ({
      method,
      route: path === undefined ? undefined : { path },
      url,
      // Sensitive payload the service must never read or persist (Req 11.3).
      body: { accessToken: SECRET, password: SECRET },
    }));

  it('writes exactly one redacted AuditLog row carrying the required fields and no token/resource value', async () => {
    // Validates: Requirements 11.1, 11.2, 11.3
    const create = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      auditLog: { create },
    } as unknown as PrismaService;
    const service = new AuthorizationAuditService(prisma);

    await fc.assert(
      fc.asyncProperty(metaArb, reqArb, async (meta, req) => {
        create.mockClear();

        await service.recordDenial(meta, req);

        // (1) EXACTLY ONE entry per denial (Req 11.1).
        expect(create).toHaveBeenCalledTimes(1);

        const data = create.mock.calls[0][0].data;

        // (2) Required fields are present (Req 11.1, 11.2).
        expect(data.userId).toBe(meta.userId);
        expect(data.workspaceId).toBe(meta.workspaceId);
        expect(data.outcome).toBe(meta.outcome);
        expect(typeof data.action).toBe('string');
        expect(data.action.length).toBeGreaterThan(0);

        if (meta.outcome === 'cross_tenant_denied') {
          // Cross-tenant 404 additionally records the referenced resource (Req 11.2).
          expect(data.resourceType).toBe(meta.resourceType);
          expect(data.resourceId).toBe(meta.resourceId);
        } else {
          // Non-cross-tenant outcomes carry no referenced resource id (Req 11.2).
          expect(data.resourceId ?? null).toBeNull();
        }

        // (3) No decrypted token / secret / resource field value leaks into the row.
        // The body secret must be absent from the entire serialized row (Req 11.3).
        expect(JSON.stringify(data)).not.toContain(SECRET);
      }),
      { numRuns: 200 },
    );
  });
});
