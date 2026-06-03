import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PrismaService } from '../../../prisma/prisma.service';
import { MembershipDeniedException } from '../authorization/authorization.exceptions';
import { AuthContext } from '../decorators/auth-context.decorators';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Resolves the request authorization context and attaches it to the request as
 * `req.authContext`. This is the SINGLE source of `Active_Workspace` and `Role`;
 * nothing downstream reads workspace/identity from client input (Req 2.1–2.4, 3.1).
 *
 * Pipeline position: runs after `JwtAuthGuard` (which populates `req.user` via
 * passport-jwt) and before `RolesGuard`. `@Public()` routes are bypassed using the
 * same `Reflector`/`IS_PUBLIC_KEY` pattern as `jwt-auth.guard.ts`.
 */
@Injectable()
export class WorkspaceContextGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = ctx
      .switchToHttp()
      .getRequest<{
        user?: { id?: string; tokenWorkspaceId?: string | null };
        authContext?: AuthContext;
      }>();

    const userId = req.user?.id; // JWT `sub` only (Req 2.1)
    const candidate = req.user?.tokenWorkspaceId; // JWT `workspaceId` claim only (Req 2.2)
    if (!userId || !candidate) {
      throw new UnauthorizedException(); // claim unresolvable → 401 (Req 2.6)
    }

    let membership: { workspaceId: string; role: AuthContext['role'] } | null;
    try {
      membership = await this.prisma.teamMember.findUnique({
        where: { workspaceId_userId: { workspaceId: candidate, userId } }, // authoritative store (Req 3.1)
        select: { workspaceId: true, role: true },
      });
    } catch {
      throw new InternalServerErrorException(); // DB/infra failure → 500 (Req 3.5)
    }

    if (!membership) {
      throw new MembershipDeniedException(userId, candidate); // no membership → 403 (Req 3.2)
    }

    req.authContext = {
      userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };
    return true;
  }
}
