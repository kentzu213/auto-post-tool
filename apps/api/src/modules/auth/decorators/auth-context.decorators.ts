import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * The request-scoped authorization context resolved once per request from the
 * verified JWT and the authoritative `TeamMember` store, and attached to the
 * request by `WorkspaceContextGuard`. It is the single source of identity,
 * workspace, and role for downstream handlers (Req 2.5) — never client input.
 */
export interface AuthContext {
  userId: string; // = JWT sub (Req 2.1)
  workspaceId: string; // membership-verified Active_Workspace (Req 2.2)
  role: Role; // verified TeamMember.role (Req 2.5)
}

const getAuthContext = (ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<{ authContext: AuthContext }>();
  return req.authContext;
};

/** Resolves the principal user identity (JWT `sub`) from `req.authContext`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => getAuthContext(ctx).userId,
);

/** Resolves the membership-verified Active_Workspace from `req.authContext`. */
export const ActiveWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    getAuthContext(ctx).workspaceId,
);

/** Resolves the verified TeamMember role from `req.authContext`. */
export const CurrentRole = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Role => getAuthContext(ctx).role,
);
