// Feature: workspace-authorization, Property 1: Server-derived identity and workspace
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import fc from 'fast-check';

import { WorkspaceContextGuard } from './workspace-context.guard';

/**
 * Property 1 (Validates: Requirements 2.1, 2.2, 2.3, 2.4).
 *
 * The resolved `req.authContext` is a function of the verified JWT (`req.user.id` =
 * `sub`, `req.user.tokenWorkspaceId` = the `workspaceId` claim) and the
 * membership-verified workspace ONLY. Any `userId`/`workspaceId` a client smuggles
 * into the query string, path params, or request body is never read, never alters the
 * resolved context, and never raises a mismatch error (the request proceeds).
 *
 * To make any leak detectable, JWT-derived ids live in the `jwt-*` namespace and all
 * client-supplied ids live in the disjoint `client-*` namespace, so a client value can
 * never coincide with a server-derived value by chance.
 *
 * The guard is exercised directly with hand-built fakes (no Nest DI): a configurable
 * `teamMember.findUnique`, a `Reflector` that reports the route is NOT `@Public()`, and
 * an `ExecutionContext` whose request carries both the JWT principal and adversarial
 * client input — fast and deterministic without a database.
 */
const ROLES: Role[] = ['owner', 'editor', 'approver', 'viewer'];

// Reflector that always reports the route is not public, so the guard runs its full
// resolution pipeline (matching the production @Public() bypass contract).
const reflector = {
  getAllAndOverride: () => false,
} as unknown as Reflector;

function buildExecutionContext(req: unknown): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

// Disjoint id namespaces so any client value leaking into authContext is detectable.
const jwtUserIdArb = fc.string().map((s) => `jwt-sub:${s}`);
const jwtWorkspaceIdArb = fc.string().map((s) => `jwt-ws:${s}`);
const clientUserIdArb = fc.string().map((s) => `client-user:${s}`);
const clientWorkspaceIdArb = fc.string().map((s) => `client-ws:${s}`);
const roleArb = fc.constantFrom<Role>(...ROLES);

describe('WorkspaceContextGuard — Property 1: server-derived identity and workspace', () => {
  it('resolves authContext from JWT sub + verified membership, never from client-supplied query/params/body', async () => {
    // Validates: Requirements 2.1, 2.2, 2.3, 2.4
    await fc.assert(
      fc.asyncProperty(
        jwtUserIdArb,
        jwtWorkspaceIdArb,
        roleArb,
        clientUserIdArb,
        clientWorkspaceIdArb,
        clientUserIdArb,
        clientWorkspaceIdArb,
        clientUserIdArb,
        clientWorkspaceIdArb,
        async (
          jwtUserId,
          jwtWorkspaceId,
          role,
          queryUserId,
          queryWorkspaceId,
          paramUserId,
          paramWorkspaceId,
          bodyUserId,
          bodyWorkspaceId,
        ) => {
          // Membership exists: the authoritative store returns the workspace derived
          // from the JWT-claim lookup (workspaceId_userId) plus the verified role.
          let capturedWhere: {
            workspaceId_userId: { workspaceId: string; userId: string };
          } | null = null;
          const findUnique = jest.fn(
            async ({
              where,
            }: {
              where: {
                workspaceId_userId: { workspaceId: string; userId: string };
              };
            }) => {
              capturedWhere = where;
              return {
                workspaceId: where.workspaceId_userId.workspaceId,
                role,
              };
            },
          );
          const prisma = { teamMember: { findUnique } } as any;
          const guard = new WorkspaceContextGuard(prisma, reflector);

          const req: any = {
            user: { id: jwtUserId, tokenWorkspaceId: jwtWorkspaceId },
            // Adversarial client input in every position a handler could read.
            query: { userId: queryUserId, workspaceId: queryWorkspaceId },
            params: { userId: paramUserId, workspaceId: paramWorkspaceId },
            body: { userId: bodyUserId, workspaceId: bodyWorkspaceId },
          };

          const result = await guard.canActivate(buildExecutionContext(req));

          // No mismatch error — the request proceeds regardless of client input.
          expect(result).toBe(true);

          // The membership lookup used ONLY the JWT-derived pair, never client input.
          expect(capturedWhere).not.toBeNull();
          expect(capturedWhere!.workspaceId_userId.userId).toBe(jwtUserId);
          expect(capturedWhere!.workspaceId_userId.workspaceId).toBe(
            jwtWorkspaceId,
          );

          // Identity = JWT sub; workspace = membership-verified workspace; role = stored.
          expect(req.authContext).toBeDefined();
          expect(req.authContext.userId).toBe(jwtUserId);
          expect(req.authContext.workspaceId).toBe(jwtWorkspaceId);
          expect(req.authContext.role).toBe(role);

          // ...and NEVER any client-supplied value.
          const clientValues = [
            queryUserId,
            queryWorkspaceId,
            paramUserId,
            paramWorkspaceId,
            bodyUserId,
            bodyWorkspaceId,
          ];
          expect(clientValues).not.toContain(req.authContext.userId);
          expect(clientValues).not.toContain(req.authContext.workspaceId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
