import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

import { RoleDeniedException } from '../authorization/authorization.exceptions';
import { AuthContext } from '../decorators/auth-context.decorators';
import { RolesGuard } from './roles.guard';

/**
 * Task 2.4 — `RolesGuard` short-circuit unit tests (Req 6.7, 9.2).
 *
 * The guard runs after `WorkspaceContextGuard`, which attaches the server-derived
 * `req.authContext`. The role enforced is ALWAYS `req.authContext.role` (the verified
 * `TeamMember.role`), never client input. These tests drive the guard directly with
 * hand-built fakes (no Nest DI) so they stay fast and deterministic without a database.
 *
 * Verified behaviors:
 * - No `@RequireRole` metadata (reflector → undefined/[]) → allow (read endpoints).
 * - `authContext.role` in the required set → allow.
 * - `authContext.role === 'owner'` → always allow (owner is permitted every action).
 * - role NOT in the required set → `RoleDeniedException` (403), handler never reached.
 * - the role is read ONLY from `req.authContext`, never from query/body.
 */
describe('RolesGuard (short-circuit)', () => {
  /** Builds a `Reflector` whose `getAllAndOverride` returns the configured roles. */
  const buildReflector = (
    requiredRoles: Role[] | undefined,
  ): { reflector: Reflector; getAllAndOverride: jest.Mock } => {
    const getAllAndOverride = jest.fn().mockReturnValue(requiredRoles);
    const reflector = { getAllAndOverride } as unknown as Reflector;
    return { reflector, getAllAndOverride };
  };

  /**
   * Builds an `ExecutionContext` stub exposing `getHandler()`, `getClass()`, and
   * `switchToHttp().getRequest()` returning the supplied request object. `getHandler`
   * returns a spy so we can assert the guard never invokes the route handler.
   */
  const buildContext = (
    request: unknown,
  ): { ctx: ExecutionContext; handlerSpy: jest.Mock } => {
    const handlerSpy = jest.fn();
    const ctx = {
      getHandler: () => handlerSpy,
      getClass: () => class FakeController {},
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    return { ctx, handlerSpy };
  };

  const authContext = (role: Role): AuthContext => ({
    userId: 'user-1',
    workspaceId: 'ws-1',
    role,
  });

  it('allows the request when no @RequireRole metadata is present (undefined)', () => {
    const { reflector } = buildReflector(undefined);
    const { ctx, handlerSpy } = buildContext({ authContext: authContext('viewer') });

    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(ctx)).toBe(true);
    // The guard retrieves the handler reference but must never invoke it.
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('allows the request when @RequireRole metadata is an empty array (read endpoints)', () => {
    const { reflector } = buildReflector([]);
    const { ctx } = buildContext({ authContext: authContext('viewer') });

    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows the request when authContext.role is in the required set', () => {
    const { reflector } = buildReflector(['owner', 'editor']);
    const { ctx } = buildContext({ authContext: authContext('editor') });

    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('always allows an owner even when owner is not explicitly listed', () => {
    const { reflector } = buildReflector(['editor', 'approver']);
    const { ctx } = buildContext({ authContext: authContext('owner') });

    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws RoleDeniedException (403) when the role is not in the required set, without reaching the handler', () => {
    const { reflector } = buildReflector(['owner', 'editor']);
    const { ctx, handlerSpy } = buildContext({ authContext: authContext('viewer') });

    const guard = new RolesGuard(reflector);

    let thrown: unknown;
    try {
      guard.canActivate(ctx);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RoleDeniedException);
    expect((thrown as RoleDeniedException).getStatus()).toBe(403);
    // Denial short-circuits: the route handler is never invoked.
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('reads the role ONLY from req.authContext, ignoring a misleading body/query role', () => {
    // Required roles do NOT include the verified role ('viewer'), but the client has
    // smuggled an elevated 'owner' role into the body and query. The guard must ignore
    // those and deny based solely on req.authContext.role.
    const { reflector } = buildReflector(['owner', 'editor']);
    const { ctx } = buildContext({
      authContext: authContext('viewer'),
      body: { role: 'owner' },
      query: { role: 'owner' },
    });

    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(ctx)).toThrow(RoleDeniedException);
  });
});
