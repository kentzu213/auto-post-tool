import { Module } from '@nestjs/common';

import { AuthorizationAuditFilter } from './authorization-audit.filter';
import { AuthorizationAuditService } from './authorization-audit.service';
import { TenantScopeService } from './tenant-scope.service';

/**
 * Provides the request-scoped authorization helpers that feature modules and the
 * global pipeline depend on (task 6.1).
 *
 * - `TenantScopeService` and `AuthorizationAuditService` are exported so the
 *   feature modules rolled out in Phase 3 (tasks 8–16) can inject them.
 * - `AuthorizationAuditFilter` is provided so it can be resolved (via `app.get`)
 *   and bound as a global exception filter in `main.ts` — see the filter-ordering
 *   note there and in `app.module.ts`.
 *
 * `PrismaService` is available everywhere because `PrismaModule` is `@Global`, so no
 * explicit import is required for the services/filter to receive it.
 */
@Module({
  providers: [
    TenantScopeService,
    AuthorizationAuditService,
    AuthorizationAuditFilter,
  ],
  exports: [TenantScopeService, AuthorizationAuditService],
})
export class AuthorizationModule {}
