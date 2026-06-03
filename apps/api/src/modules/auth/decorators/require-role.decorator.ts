import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

/**
 * Metadata key under which the roles required by a handler/class are stored.
 * Read by `RolesGuard` via `Reflector` (Req 6.3, 6.7).
 */
export const ROLES_KEY = 'requiredRoles';

/**
 * Declares the set of `TeamMember` roles permitted to invoke a handler (or every
 * handler on a class). Usage matches the design, e.g. `@RequireRole('owner', 'editor')`.
 *
 * Handlers WITHOUT this decorator carry no metadata, so `RolesGuard` allows them
 * (read endpoints need no annotation). The role checked at runtime is always the
 * server-derived `req.authContext.role`, never client input.
 */
export const RequireRole = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
