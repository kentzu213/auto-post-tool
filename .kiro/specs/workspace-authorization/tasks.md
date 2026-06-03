# Implementation Plan: Workspace Authorization

## Overview

This plan adds a consistent authorization and multi-tenant isolation layer over the **existing**
NestJS API (`apps/api`) and BullMQ worker (`apps/worker`). It is a surgical hardening pass, not a
rewrite: a small reusable set of guards, decorators, a context resolver, a tenant helper, and one
exception filter are built first (behavior-neutral), then wired globally, then applied
module-by-module, then to the worker, and finally the OAuth fallback is removed.

Implementation language is **TypeScript (NestJS)**, matching the existing stack. Property-based
tests use **fast-check** with the existing Jest setup (≥ 100 iterations via
`fc.assert(fc.property(...), { numRuns: 100 })`), each tagged
`Feature: workspace-authorization, Property k`.

Task ordering follows the design's "Migration and Rollout Strategy" so the system stays releasable
at every step:
1. **Phase 1 — Foundation** (tasks 1–5): build primitives, not wired globally; no behavior change.
2. **Phase 2 — Global auth** (tasks 6–7): register guards via `APP_GUARD` + `@Public()` opt-outs.
3. **Phase 3 — Module rollout** (tasks 8–17): templates → social-auth → posts → campaigns →
   analytics → inbox → approvals → notifications → media.
4. **Phase 4 — Worker isolation** (tasks 18–19).
5. **Phase 5 — OAuth fallback removal** (tasks 20–21).

Conventions:
- Sub-tasks marked `*` are optional test tasks and are **not** auto-implemented.
- Each of the design's 10 Correctness Properties is realized as one optional `*` property-based test
  task. Property 7 (RBAC matrix) and Property 9 (worker resolution) are the highest-value pure-logic
  PBTs.
- `_Requirements: N.M_` traces each task to acceptance criteria; `Property k` marks tasks that
  realize a Correctness Property from the design.

## Tasks

- [x] 1. Phase 1 — Request-context primitives (no global wiring yet)
  - [x] 1.1 Add `@Public()` decorator and make `JwtAuthGuard` honor it
    - Create `apps/api/src/modules/auth/decorators/public.decorator.ts` exporting `IS_PUBLIC_KEY` and `Public()`
    - Extend `apps/api/src/modules/auth/guards/jwt-auth.guard.ts` to read `IS_PUBLIC_KEY` via `Reflector` and bypass `super.canActivate` for public routes, remaining the passport-jwt entry point (401 on missing/expired/malformed/bad-signature/`sub`-not-found is produced by passport unchanged)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 1.2 Surface `tokenWorkspaceId` from `JwtStrategy.validate`
    - In `apps/api/src/modules/auth/strategies/jwt.strategy.ts`, return `{ ...user, tokenWorkspaceId: payload.workspaceId ?? null }` so the context guard can read the JWT `workspaceId` claim; keep loading the `User` by `sub` and the existing 401-on-missing-user behavior
    - _Requirements: 2.1, 2.2, 2.5_
  - [x] 1.3 Implement `WorkspaceContextGuard` resolving `AuthContext`
    - Create `apps/api/src/modules/auth/guards/workspace-context.guard.ts` with `interface AuthContext { userId; workspaceId; role }`; derive `userId` from `req.user.id` (JWT `sub`) and the candidate workspace from `req.user.tokenWorkspaceId` only; 401 when either is absent; verify `teamMember.findUnique({ workspaceId_userId })` against the authoritative store; on DB error throw `InternalServerErrorException` (500); on no membership throw `MembershipDeniedException` (403); on success attach `req.authContext`. Bypass for `@Public()` routes
    - _Requirements: 2.1, 2.2, 2.6, 3.1, 3.2, 3.5_
  - [x]* 1.4 Write property test for server-derived identity and workspace
    - **Feature: workspace-authorization, Property 1: Server-derived identity and workspace**
    - Generate arbitrary client-supplied `userId`/`workspaceId` (query/path/body); assert the resolved `AuthContext` depends only on JWT `sub` + membership-verified claim and that supplied values never alter it nor raise a mismatch error
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x]* 1.5 Write property test for membership gating
    - **Feature: workspace-authorization, Property 2: Membership gates every authorized request**
    - Over a fake `teamMember` store, generate member/non-member pairs; assert the guard proceeds iff a `TeamMember` row exists, and otherwise rejects with 403 with no data access
    - _Requirements: 3.1, 3.2, 3.4_
  - [x] 1.6 Add `@CurrentUser` / `@ActiveWorkspace` / `@CurrentRole` param decorators
    - Create `apps/api/src/modules/auth/decorators/auth-context.decorators.ts` reading `req.authContext.{userId,workspaceId,role}` so handlers never read identity/workspace from client input
    - _Requirements: 2.5_

- [x] 2. Phase 1 — RBAC primitives
  - [x] 2.1 Implement `PermissionMatrix` and `can()`
    - Create `apps/api/src/modules/auth/authorization/permission-matrix.ts` with the `Action` union and matrix (`content.create/update/delete`, `post.publish`, `approval.review`, `social.connect/disconnect`) and `can(action, role)` where `owner` is permitted every action
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 7.3, 8.3, 8.6_
  - [x]* 2.2 Write property test for the RBAC permission matrix
    - **Feature: workspace-authorization, Property 7: RBAC permission matrix is enforced**
    - Generate every `(action, role)` pair; assert `can()` matches the matrix (owner always allowed) — highest-value pure-logic PBT
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.3, 7.4, 8.3, 8.4, 8.6_
  - [x] 2.3 Implement `RolesGuard` + `@RequireRole(...)`
    - Create `apps/api/src/modules/auth/guards/roles.guard.ts` and `apps/api/src/modules/auth/decorators/require-role.decorator.ts`; read required roles via `Reflector`, read the role from `req.authContext.role` only, allow when no metadata is present, and throw `RoleDeniedException` (403) carrying the attempted action when the role is not permitted
    - _Requirements: 6.3, 6.7, 9.2_
  - [x]* 2.4 Write unit tests for `RolesGuard` short-circuit
    - Assert a denied role yields 403 with the handler spy never invoked, and that a no-metadata handler is allowed (read endpoints)
    - _Requirements: 6.7, 9.2_

- [x] 3. Phase 1 — Typed exceptions and `TenantScopeService`
  - [x] 3.1 Add typed authorization exceptions
    - Create `apps/api/src/modules/auth/authorization/authorization.exceptions.ts` with `MembershipDeniedException` (extends `ForbiddenException`), `RoleDeniedException` (extends `ForbiddenException`), and `CrossTenantNotFoundException` (extends `NotFoundException`); each carries non-enumerable `meta` used only for audit; `CrossTenantNotFoundException` serializes a body byte-identical to a plain `NotFoundException`
    - _Requirements: 9.2, 9.3, 9.4_
  - [x] 3.2 Implement `TenantScopeService.requireOwned` (resolve-or-404)
    - Create `apps/api/src/modules/auth/authorization/tenant-scope.service.ts` with `requireOwned({ findScoped, findUnscopedExists, workspaceId, resourceType, resourceId })`: return the scoped record if found; on DB error throw `InternalServerErrorException` (500); on miss, throw `CrossTenantNotFoundException` when it exists in another workspace else plain `NotFoundException` — both render an identical 404 body
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 9.3_
  - [x]* 3.3 Write property test for indistinguishable cross-tenant 404
    - **Feature: workspace-authorization, Property 4: Resource-by-id isolation is indistinguishable from not-found**
    - Generate owned / cross-tenant / absent ids over a fake prisma; assert cross-tenant and absent responses deep-equal in status and body, contain no resource fields, and neither reads nor mutates the resource
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 7.2, 9.3, 9.4, 9.5_
  - [x] 3.4 Implement `TenantScopeService.requireAllOwned` (batch, all-or-nothing)
    - Add `requireAllOwned(ids, opts)` to `tenant-scope.service.ts`: verify every referenced id exists and resolves to the active workspace before any mutation; throw a 404 if any id is absent or cross-tenant so no referenced resource is changed
    - _Requirements: 5.5, 8.5, 8.7_
  - [x]* 3.5 Write property test for all-or-nothing multi-id mutations
    - **Feature: workspace-authorization, Property 5: Multi-id mutations are all-or-nothing**
    - Generate id sets mixing owned/cross-tenant/absent; assert the mutation is applied iff every id is owned, else zero rows change and the request is rejected with 404
    - _Requirements: 5.5, 8.5, 8.7_

- [x] 4. Phase 1 — Audit filter and additive `AuditLog` migration
  - [x] 4.1 Add additive nullable columns to `AuditLog` and migrate
    - In `apps/api/prisma/schema.prisma` add nullable `workspaceId`, `resourceType`, `resourceId`, `outcome` to `AuditLog` and the `@@index([workspaceId, outcome])`; generate an additive migration (`prisma migrate dev`) so existing `auditLog.create` call sites in `AuthService`/worker keep working unchanged; mirror the schema change into `apps/worker/prisma/schema.prisma`
    - _Requirements: 11.1, 11.2_
  - [x] 4.2 Implement `AuthorizationAuditFilter` + `recordDenial`
    - Create the audit service and `apps/api/src/modules/auth/authorization/authorization-audit.filter.ts` with `@Catch(MembershipDeniedException, RoleDeniedException, CrossTenantNotFoundException)`; write exactly one `AuditLog` row from `ex.meta` (userId, action+resourceType, workspaceId, outcome, timestamp; resourceId for cross-tenant 404) excluding tokens/field values; wrap the write in try/catch and always send the original 401/403/404 response
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - [x]* 4.3 Write property test for exactly-one redacted audit entry
    - **Feature: workspace-authorization, Property 10: Exactly one redacted audit entry per denial**
    - Generate denied requests across the three outcomes; assert exactly one `AuditLog` row with the required fields (plus resourceId for cross-tenant 404) and no decrypted token or resource field value
    - _Requirements: 11.1, 11.2, 11.3_
  - [x]* 4.4 Write unit test for audit-write resilience
    - Force the `AuditLog` write to throw; assert the original 403/404 is still returned with no resource data in the body
    - _Requirements: 11.4_

- [x] 5. Checkpoint — foundation compiles, not yet wired
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Phase 2 — Enable authentication globally with explicit opt-outs
  - [x] 6.1 Register guards and audit filter globally
    - In `apps/api/src/app.module.ts` register via `APP_GUARD` in order `JwtAuthGuard` → `WorkspaceContextGuard` → `RolesGuard` (matching the existing `ThrottlerGuard` pattern); register `AuthorizationAuditFilter` via `APP_FILTER` after `AllExceptionsFilter`; provide `TenantScopeService` and the audit service
    - _Requirements: 1.1, 1.5, 2.6, 3.2, 9.1, 9.2_
  - [x] 6.2 Mark public endpoints with `@Public()`
    - Apply `@Public()` to `AuthController` `register`/`login`/`supabase-sync`, `SocialAuthController` `callback/:platform`, and the health endpoint in `apps/api/src/modules/health/health.controller.ts` so only these bypass authentication
    - _Requirements: 1.1, 1.2, 1.5_
  - [x]* 6.3 Write integration test for global auth coverage
    - Enumerate the router and assert every posts/analytics/social-auth/campaigns/templates/inbox/notifications/approvals/media route rejects an unauthenticated request with 401, while the `@Public()` routes do not; confirm a valid JWT reaches the handler
    - _Requirements: 1.2, 1.5, 1.6, 9.1_

- [x] 7. Checkpoint — global authentication verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Phase 3 — Templates module scoping + RBAC
  - [x] 8.1 Scope templates to the active workspace and guard mutations
    - In `templates.controller.ts` replace `@Query('workspaceId')` with `@ActiveWorkspace()`; push `workspaceId` into every `templates.service.ts` query (`findMany`/`create` use `{ where: { workspaceId } }` / `{ data: { ...dto, workspaceId } }`), convert by-id reads/mutations to `TenantScopeService.requireOwned` (`{ id, workspaceId }`), and add `@RequireRole('owner','editor')` to create/update/delete handlers
    - _Requirements: 2.3, 3.3, 4.1, 5.1, 5.2, 6.2, 6.5_
  - [x]* 8.2 Write property test for read isolation
    - **Feature: workspace-authorization, Property 3: Reads return only active-scope records**
    - Over a multi-tenant fake of `findMany`/`findFirst`/`count`, generate records across many workspaces/users; assert every collection/aggregate read returns exactly the active-scope subset (direct, transitive, and user-scoped) and empty/zero when none, regardless of query/path/body
    - _Requirements: 3.3, 4.1, 4.2, 4.3, 4.4, 7.5, 8.1_

- [x] 9. Phase 3 — Social-auth module scoping + RBAC
  - [x] 9.1 Scope social-account list/connect/disconnect and guard mutations
    - In `social-auth.controller.ts`/`social-auth.service.ts` (and `credentials.*`): drop `@Query('workspaceId')`; scope list to `{ workspaceId }`; associate `connect/:platform` and `direct-connect` results with `@ActiveWorkspace()` and require `@RequireRole('owner','editor')`; for `disconnect` use `TenantScopeService.requireAllOwned` over the referenced account ids before deleting any, guarded by `@RequireRole('owner','editor')`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [x] 9.2 Encode the active workspace into the OAuth `state` issued at connect
    - In `getAuthRedirectUrl` (connect path) build the signed OAuth `state` from `@ActiveWorkspace()`; in the public `callback/:platform` read the workspace from the signed `state` (no JWT context) before associating the new `SocialAccount` (fallback removal handled in task 20.1)
    - _Requirements: 8.2_
  - [x]* 9.3 Write property test for connect workspace association
    - **Feature: workspace-authorization, Property 8: Connect associates the active workspace**
    - Generate connect inputs (OAuth connect, signed-state callback, direct connect) with arbitrary workspace hints; assert the created `SocialAccount.workspaceId` equals the active/signed workspace and never a client value or default
    - _Requirements: 8.2_

- [x] 10. Phase 3 — Posts module scoping, RBAC, and parent-reference checks
  - [x] 10.1 Scope posts to the active workspace and guard mutations
    - In `posts.controller.ts`/`posts.service.ts` replace `@Query('workspaceId')` with `@ActiveWorkspace()`; scope all queries to `{ workspaceId }`; convert by-id reads/mutations to `TenantScopeService.requireOwned`; add `@RequireRole('owner','editor')` to create/update/delete and to the publish handler (`post.publish`)
    - _Requirements: 2.3, 3.3, 4.1, 5.1, 5.2, 6.2, 6.5, 6.6_
  - [x] 10.2 Validate parent references on post create
    - Before creating a Post that references a `SocialAccount`/`Campaign`, verify each referenced parent exists and its owning workspace equals the active workspace (via `TenantScopeService.requireOwned`/`requireAllOwned`); reject with 404 and create nothing if any parent is missing or cross-tenant
    - _Requirements: 5.7, 5.8_
  - [x]* 10.3 Write property test for parent-reference validation on create
    - **Feature: workspace-authorization, Property 6: Parent-reference validation on create**
    - Generate parent refs across workspaces; assert the resource is created iff every referenced parent is in the active workspace, else nothing is created and the request is rejected with 404
    - _Requirements: 5.7, 5.8_

- [x] 11. Phase 3 — Campaigns module scoping + RBAC
  - [x] 11.1 Scope campaigns to the active workspace and guard mutations
    - In `campaigns.controller.ts`/`campaigns.service.ts` replace `@Query('workspaceId')` with `@ActiveWorkspace()`; scope all queries to `{ workspaceId }`; convert by-id reads/mutations to `TenantScopeService.requireOwned`; add `@RequireRole('owner','editor')` to create/update/delete handlers
    - _Requirements: 2.3, 3.3, 4.1, 5.1, 5.2, 6.2, 6.5_

- [x] 12. Phase 3 — Analytics module aggregate scoping
  - [x] 12.1 Scope analytics aggregates to the active workspace
    - In `analytics.controller.ts`/`analytics.service.ts` replace `@Query('workspaceId')` with `@ActiveWorkspace()` and add the workspace filter (direct or transitive via `schedule.post.workspaceId`) to every underlying query for dashboard/heatmap/post-stats; return zero-valued/empty aggregates when no rows match; resolve any referenced id through `TenantScopeService.requireOwned`
    - _Requirements: 2.3, 4.2, 5.1_

- [x] 13. Phase 3 — Inbox module scoping
  - [x] 13.1 Scope inbox messages and unread counts to the active workspace
    - In `inbox.controller.ts`/`inbox.service.ts` replace `@Query('workspaceId')` with `@ActiveWorkspace()`; scope reads and unread-count aggregates transitively via `socialAccount.workspaceId`; convert by-id reads/mutations to `TenantScopeService.requireOwned` (`{ id, socialAccount: { workspaceId } }`)
    - _Requirements: 2.3, 4.1, 4.2, 5.1_

- [x] 14. Phase 3 — Approvals module scoping + role enforcement
  - [x] 14.1 Scope approvals and enforce approver role
    - In `approvals.controller.ts`/`approvals.service.ts` scope `list pending` to approvals whose `post.workspaceId` equals `@ActiveWorkspace()`; on create, resolve the target Post via `TenantScopeService.requireOwned` so a cross-tenant post yields 404 and no `ApprovalRequest`; guard the approve/reject (review) handler with `@RequireRole('owner','approver')`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 15. Phase 3 — Notifications module (user-scoped)
  - [x] 15.1 Scope notifications to the principal user identity
    - In `notifications.controller.ts`/`notifications.service.ts` derive the owner from `@CurrentUser()` and ignore any supplied `userId`; scope all reads/mutations to `{ userId }` (and `requireOwned` `{ id, userId }` for by-id), returning an empty collection when the principal owns none
    - _Requirements: 2.4, 4.4_

- [x] 16. Phase 3 — Media module scoping + RBAC
  - [x] 16.1 Scope media assets to the active workspace and guard mutations
    - In `media.controller.ts`/`media.service.ts` replace `@Query('workspaceId')` with `@ActiveWorkspace()`; scope reads transitively via `post.workspaceId`; convert by-id reads/mutations to `TenantScopeService.requireOwned`; add `@RequireRole('owner','editor')` to create/upload and delete handlers
    - _Requirements: 2.3, 4.1, 5.1, 6.2, 6.5_

- [x] 17. Checkpoint — all modules tenant-isolated
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Phase 4 — Worker tenant isolation
  - [x] 18.1 Implement `resolveOwningWorkspace`
    - Create `apps/worker/src/queue/resolve-workspace.ts` exporting the `Resolution` union and `resolveOwningWorkspace(prisma, scheduleId)`: load schedule + `post.workspaceId` + `socialAccount.workspaceId` by FK; return `{ ok:false, reason:'unresolvable' }` on DB error / missing / null FK, `{ ok:false, reason:'cross_workspace_mismatch' }` when the two workspaces differ, else `{ ok:true, workspaceId }`; never read any payload workspace hint
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
  - [x] 18.2 Wire the resolver into the publish job
    - In `apps/worker/src/queue/publish.worker.ts` call `resolveOwningWorkspace` first; on `{ ok:false }` mutate nothing, mark the schedule/post failed, write a failure `AuditLog` identifying the job and reason, and rethrow to mark the BullMQ job failed (reusing existing retry/dead-letter handling); on success constrain every read/write to the resolved `workspaceId`
    - _Requirements: 10.2, 10.3, 10.4_
  - [x]* 18.3 Write property test for worker tenancy resolution
    - **Feature: workspace-authorization, Property 9: Worker resolves tenancy from stored foreign keys only**
    - Over a fake prisma, generate schedules with equal/unequal FK workspace pairs, missing resources, DB errors, and arbitrary payload hints; assert proceed iff FK workspaces are equal, otherwise halt with the correct recorded failure, and the payload hint never affects the outcome — highest-value pure-logic PBT
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 19. Checkpoint — worker isolation verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Phase 5 — Remove the OAuth default-workspace fallback
  - [x] 20.1 Remove `'default_workspace_id'` fallback from the OAuth callback
    - In `social-auth.service.ts`/`social-auth.controller.ts` remove `state || 'default_workspace_id'`; derive the workspace solely from the signed `state` issued at connect (task 9.2); fail the callback (no `SocialAccount` created/associated) when `state` is absent or invalid
    - _Requirements: 2.6, 8.2_

- [x] 21. Final checkpoint — full authorization layer verified
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and are not auto-implemented; they cover the 10
  property-based tests plus a few unit/integration tests for wiring concerns (guard short-circuit,
  global 401 coverage, audit-write resilience).
- Property-based tests use fast-check with ≥ 100 iterations, each tagged
  `Feature: workspace-authorization, Property k`. Pure-logic invariants are implemented as PBTs:
  Property 7 (2.2) and Property 9 (18.3) are the highest value; Properties 1 (1.4), 2 (1.5),
  4 (3.3), 5 (3.5), 3 (8.2), 8 (9.3), 6 (10.3), 10 (4.3) run against extracted pure functions or an
  in-memory fake of the Prisma calls, so they stay fast and deterministic without a live database.
- The plan follows the design's 5 rollout phases so the system is releasable at every step:
  authentication is hardened first (Phase 2), each module's tenant isolation is added behind
  already-verified identity (Phase 3), the worker is isolated last (Phase 4), and the OAuth fallback
  is removed once the signed-state path exists (Phase 5).
- The `AuditLog` migration (4.1) is purely additive (all new columns nullable), so existing
  `auditLog.create` call sites in `AuthService` and the worker keep working unchanged.
- **Web client follow-up (out of scope here):** per Req 2.3 the API *ignores* any client-supplied
  `workspaceId` rather than rejecting it, so the existing Next.js client keeps working during
  rollout. Removing `workspaceId` from client requests is a separate follow-up and is not a coding
  task in this spec.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.6", "2.1", "3.1", "4.1"] },
    { "id": 1, "tasks": ["1.3", "2.3", "3.2", "4.2"] },
    { "id": 2, "tasks": ["1.4", "1.5", "2.2", "2.4", "3.3", "3.4", "4.3", "4.4"] },
    { "id": 3, "tasks": ["3.5", "6.1", "6.2"] },
    { "id": 4, "tasks": ["6.3", "8.1", "9.1", "10.1", "11.1", "12.1", "13.1", "14.1", "15.1", "16.1"] },
    { "id": 5, "tasks": ["8.2", "9.2", "10.2"] },
    { "id": 6, "tasks": ["9.3", "10.3", "18.1"] },
    { "id": 7, "tasks": ["18.2"] },
    { "id": 8, "tasks": ["18.3", "20.1"] }
  ]
}
```
