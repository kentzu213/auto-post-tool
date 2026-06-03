// Feature: workspace-authorization, Property 2: Membership gates every authorized request
import {
  InternalServerErrorException,
  UnauthorizedException,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import fc from 'fast-check';

import { MembershipDeniedException } from '../authorization/authorization.exceptions';
import { WorkspaceContextGuard } from './workspace-context.guard';

/**
 * Property 2 (Validates: Requirements 3.1, 3.2, 3.4).
 *
 * Membership gates every authorized request: over a fake `TeamMember` store keyed by
 * `(workspaceId, userId)`, `canActivate` resolves `true` and attaches `req.authContext`
 * IF AND ONLY IF a row exists for the JWT-derived (userId, candidateWorkspaceId) pair.
 * When no row exists the guard throws `MembershipDeniedException` (403), attaches no
 * context, and never proceeds.
 *
 * Boundary outcomes are also covered:
 *  - missing `userId` OR missing `tokenWorkspaceId`        → UnauthorizedException (401)
 *  - `teamMember.findUnique` throwing (DB/infra failure)   → InternalServerErrorException (500)
 *
 * The guard is exercised directly with hand-built fakes (no Nest DI) so it stays fast
 * and deterministic without a database.
 */
const ROLES: Role[] = ['owner', 'editor', 'approver', 'viewer'];

// Always-not-public Reflector so the full resolution pipeline runs.
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

const memberKey = (workspaceId: string, userId: string) =>
  `${workspaceId}\u0000${userId}`;

// Build a fake teamMember store from a list of (workspaceId, userId, role) rows.
function buildPrisma(
  store: Map<string, Role>,
): { teamMember: { findUnique: jest.Mock } } {
  const findUnique = jest.fn(
    async ({
      where,
    }: {
      where: {
        workspaceId_userId: { workspaceId: string; userId: string };
      };
    }) => {
      const { workspaceId, userId } = where.workspaceId_userId;
      const role = store.get(memberKey(workspaceId, userId));
      return role ? { workspaceId, role } : null;
    },
  );
  return { teamMember: { findUnique } };
}

const userIdArb = fc.string({ minLength: 1 }).map((s) => `u:${s}`);
const workspaceIdArb = fc.string({ minLength: 1 }).map((s) => `w:${s}`);
const roleArb = fc.constantFrom<Role>(...ROLES);

describe('WorkspaceContextGuard — Property 2: membership gates every authorized request', () => {
  it('proceeds and attaches authContext iff a TeamMember row exists, else 403 with no context', async () => {
    // Validates: Requirements 3.1, 3.2, 3.4
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        workspaceIdArb,
        roleArb,
        fc.boolean(),
        async (userId, candidateWorkspaceId, role, isMember) => {
          const store = new Map<string, Role>();
          if (isMember) {
            store.set(memberKey(candidateWorkspaceId, userId), role);
          }
          const prisma = buildPrisma(store) as any;
          const guard = new WorkspaceContextGuard(prisma, reflector);

          const req: any = {
            user: { id: userId, tokenWorkspaceId: candidateWorkspaceId },
          };
          const ctx = buildExecutionContext(req);

          if (isMember) {
            const result = await guard.canActivate(ctx);
            expect(result).toBe(true);
            expect(req.authContext).toEqual({
              userId,
              workspaceId: candidateWorkspaceId,
              role,
            });
          } else {
            await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
              MembershipDeniedException,
            );
            // No context attached, request did not proceed.
            expect(req.authContext).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns 403 (Forbidden) status for the membership denial', async () => {
    // Validates: Requirement 3.2 — denial maps to HTTP 403.
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        workspaceIdArb,
        async (userId, candidateWorkspaceId) => {
          const prisma = buildPrisma(new Map()) as any; // empty store → never a member
          const guard = new WorkspaceContextGuard(prisma, reflector);
          const req: any = {
            user: { id: userId, tokenWorkspaceId: candidateWorkspaceId },
          };

          let thrown: unknown;
          try {
            await guard.canActivate(buildExecutionContext(req));
          } catch (err) {
            thrown = err;
          }
          expect(thrown).toBeInstanceOf(MembershipDeniedException);
          expect((thrown as MembershipDeniedException).getStatus()).toBe(403);
          expect(req.authContext).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects with 401 when userId or tokenWorkspaceId is absent, without querying membership', async () => {
    // Validates: Requirement 2.6 boundary feeding the membership gate — an unresolvable
    // claim never reaches the authoritative store.
    const presence = fc.constantFrom<'no-user' | 'no-ws' | 'neither'>(
      'no-user',
      'no-ws',
      'neither',
    );
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        workspaceIdArb,
        presence,
        async (userId, candidateWorkspaceId, missing) => {
          const findUnique = jest.fn();
          const prisma = { teamMember: { findUnique } } as any;
          const guard = new WorkspaceContextGuard(prisma, reflector);

          const user: { id?: string; tokenWorkspaceId?: string | null } = {};
          if (missing !== 'no-user' && missing !== 'neither') {
            user.id = userId;
          }
          if (missing !== 'no-ws' && missing !== 'neither') {
            user.tokenWorkspaceId = candidateWorkspaceId;
          }
          const req: any = { user };

          await expect(
            guard.canActivate(buildExecutionContext(req)),
          ).rejects.toBeInstanceOf(UnauthorizedException);
          // Membership store is never consulted when the claim is unresolvable.
          expect(findUnique).not.toHaveBeenCalled();
          expect(req.authContext).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('maps a teamMember.findUnique failure to 500 with no context attached', async () => {
    // Validates: Requirement 3.5 — infra failure during membership verification → 500.
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        workspaceIdArb,
        async (userId, candidateWorkspaceId) => {
          const findUnique = jest.fn(async () => {
            throw new Error('db connection lost');
          });
          const prisma = { teamMember: { findUnique } } as any;
          const guard = new WorkspaceContextGuard(prisma, reflector);
          const req: any = {
            user: { id: userId, tokenWorkspaceId: candidateWorkspaceId },
          };

          await expect(
            guard.canActivate(buildExecutionContext(req)),
          ).rejects.toBeInstanceOf(InternalServerErrorException);
          expect(req.authContext).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});
