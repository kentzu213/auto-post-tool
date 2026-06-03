import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

import { RoleDeniedException } from '../authorization/authorization.exceptions';
import { AuthContext } from '../decorators/auth-context.decorators';
import { ROLES_KEY } from '../decorators/require-role.decorator';

/**
 * Enforces role-based access for handlers annotated with `@RequireRole(...)`
 * (Req 6.3, 6.7, 9.2).
 *
 * Pipeline position: runs after `WorkspaceContextGuard`, which attaches the
 * server-derived `req.authContext`. The role checked is ALWAYS
 * `req.authContext.role` (the verified `TeamMember.role`), never client input.
 *
 * Behavior:
 * - No `@RequireRole` metadata on the handler/class → allow (read endpoints need
 *   no annotation).
 * - Role present in the required set → allow.
 * - Role not in the required set → `RoleDeniedException` (403).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    // No @RequireRole metadata → not a role-gated endpoint → allow (Req 6, read endpoints).
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const req = ctx
      .switchToHttp()
      .getRequest<{ authContext?: AuthContext }>();
    const authContext = req.authContext;

    // `owner` is permitted every action (Req 6.1); otherwise the role must be listed.
    if (
      authContext &&
      (authContext.role === 'owner' || requiredRoles.includes(authContext.role))
    ) {
      return true;
    }

    // Role not permitted → 403. The attempted action is derived by the audit
    // filter from the request route, so it is omitted here (Req 6.3, 6.7, 9.2).
    throw new RoleDeniedException(
      authContext?.userId ?? '',
      authContext?.workspaceId ?? '',
    );
  }
}
