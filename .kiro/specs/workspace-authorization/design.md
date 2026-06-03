# Design Document

## Overview

This feature adds a consistent authorization and multi-tenant isolation layer on top of the
existing NestJS API (`apps/api`) and BullMQ worker (`apps/worker`). It does **not** rewrite the
application; it inserts a small, reusable set of guards, decorators, a context resolver, a tenant
helper, and one exception filter, then applies them module-by-module so existing authenticated
flows keep working.

The core idea is a single, server-derived **request authorization context**
`{ userId, workspaceId, role }` computed once per request from the verified JWT and the
authoritative `TeamMember` store, and **never** from client input. Every controller reads identity
and workspace from this context (via param decorators) instead of from `@Query('workspaceId')`,
which is the root cause of the current IDOR vulnerabilities. Every service query is scoped to the
resolved `workspaceId`. Resource-by-id access is resolved through the workspace before any read or
mutation, and cross-tenant references return a `404` that is byte-identical to a genuine not-found.

Authentication mechanics (JWT issuance, passport-jwt, bcrypt, AES-256-GCM token encryption) are
reused as-is. The worker resolves the owning workspace of each job from stored foreign keys and
refuses to act across a tenant boundary.

### What already exists (reused)

- `JwtAuthGuard` (`modules/auth/guards/jwt-auth.guard.ts`) — a bare `AuthGuard('jwt')`.
- `JwtStrategy` (`modules/auth/strategies/jwt.strategy.ts`) — validates signature/expiry and loads
  the `User` by `sub`. **Note:** it currently returns only `{ id, email, name }` and drops the
  `workspaceId` claim that `AuthService` puts into the token.
- JWT claims: `{ sub: userId, email, workspaceId }` (`workspaceId` may be `null`).
- `TeamMember` with `@@unique([workspaceId, userId])` and a `Role` enum (`owner`, `editor`,
  `approver`, `viewer`).
- `AuditLog` model (will be extended with nullable structured columns — see Data Models).
- `APP_GUARD` registration pattern already used for `ThrottlerGuard` in `app.module.ts`.
- `AllExceptionsFilter` (`common/observability/all-exceptions.filter.ts`) for Sentry/metrics.

### What this feature adds

- A global `JwtAuthGuard` + a `@Public()` decorator (fail-closed by default).
- A `WorkspaceContextGuard` that resolves and attaches `req.authContext`.
- `@CurrentUser()`, `@ActiveWorkspace()`, `@CurrentRole()` param decorators.
- A `RolesGuard` + `@RequireRole(...)` decorator backed by a `PermissionMatrix`.
- A `TenantScopeService` helper for resolve-or-404 ownership checks (single & batch).
- Typed authorization exceptions + an `AuthorizationAuditFilter` that writes exactly one
  redacted `AuditLog` entry on denial.
- A worker `resolveOwningWorkspace()` guard step for tenant isolation.

## Architecture

### Request authorization pipeline (API)

Guards run in a fixed order so failures short-circuit cleanly and responses never leak existence
(Req 9.1, 9.2). NestJS executes guards in registration order; global guards run before
controller/handler guards.

```mermaid
flowchart TD
    A[Incoming HTTP request] --> B{`@Public()`?}
    B -- yes --> H[Handler executes]
    B -- no --> C[JwtAuthGuard\nverify signature/expiry, load User by sub]
    C -- invalid/missing --> R401[401 Unauthorized]
    C -- valid --> D[WorkspaceContextGuard\nderive workspaceId from JWT claim,\nverify TeamMember membership]
    D -- claim unresolvable --> R401
    D -- no membership --> R403[403 Forbidden + audit]
    D -- db failure --> R500[500]
    D -- ok: attach req.authContext --> E[RolesGuard\n`@RequireRole` vs PermissionMatrix]
    E -- role not permitted --> R403
    E -- permitted / no role required --> H
    H --> F[Service: queries scoped to authContext.workspaceId]
    F -- resolve-by-id miss / cross-tenant --> R404[404 Not Found + audit if cross-tenant]
    F -- ok --> OK[200/201 response]
```

Decision stages map directly to the requirement's `Authorization_Decision` order:

1. **Authentication** (`JwtAuthGuard`) → 401 (Req 1, 9.1).
2. **Membership** (`WorkspaceContextGuard`) → 403 (Req 3.2, 9.2).
3. **Role** (`RolesGuard`) → 403 (Req 6, 9.2).
4. **Ownership** (`TenantScopeService` inside services) → cross-tenant 404 (Req 5, 9.3).

Each later stage runs only if every earlier stage passed, so a 401 never evaluates membership and a
403 never evaluates ownership (Req 9.1, 9.2).

### Global vs per-controller guards — decision

**Recommendation: register `JwtAuthGuard` and `WorkspaceContextGuard` globally via `APP_GUARD`,
with a `@Public()` opt-out for `login`, `register`, `supabase-sync`, OAuth `callback`, and
`health`.**

Rationale: the confirmed root cause is that **most controllers forgot to apply the guard**. A
per-controller approach repeats the same mistake surface — any new controller that forgets the
decorator is silently unauthenticated. A global guard is **fail-closed**: every route is protected
unless explicitly marked `@Public()`, which makes "forgetting" safe (it over-protects, never
under-protects). This matches the existing `APP_GUARD` pattern already used for `ThrottlerGuard`.
`RolesGuard` is also registered globally but is a no-op unless a handler carries `@RequireRole(...)`
metadata, so read endpoints need no annotation.

The OAuth `callback` endpoint stays `@Public()` (the browser is redirected there by the provider
with no Authorization header); its workspace is taken from the signed OAuth `state` it issued, not
from the JWT — addressed in the Components section (Req 8.2).

### Worker authorization (no HTTP context)

The worker has no request/JWT. Its tenant boundary is derived purely from the database. At the start
of each job it resolves the owning workspace from the job's stored foreign keys, verifies all
referenced resources resolve to the **same** workspace, and only then proceeds. Any `workspaceId`
present in the job payload is ignored (Req 10.5).

```mermaid
flowchart TD
    J[Job: { scheduleId }] --> L[Load schedule + post + socialAccount by FK]
    L -- not found / db error --> F1[Halt: mark failed + record resolution failure]
    L -- found --> M{post.workspaceId == socialAccount.workspaceId?}
    M -- no --> F2[Halt: mark failed + record cross-workspace mismatch]
    M -- yes --> P[Proceed: all access constrained to resolved workspaceId]
```

## Components and Interfaces

### 1. `@Public()` decorator + global `JwtAuthGuard` (Req 1)

```ts
// modules/auth/decorators/public.decorator.ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

`JwtAuthGuard` is extended to honor `@Public()` and to remain the passport-jwt entry point:

```ts
// modules/auth/guards/jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) { super(); }

  canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(ctx);
  }
}
```

Registered globally:

```ts
// app.module.ts providers
{ provide: APP_GUARD, useClass: JwtAuthGuard },        // runs 1st (Req 1)
{ provide: APP_GUARD, useClass: WorkspaceContextGuard }, // runs 2nd (Req 2, 3)
{ provide: APP_GUARD, useClass: RolesGuard },          // runs 3rd (Req 6)
```

`@Public()` is applied to: `AuthController` register/login/supabase-sync, `SocialAuthController`
`callback/:platform`, and the health endpoint. Passport's failure (missing/expired/malformed token,
or `sub` not resolving to a `User`) already produces `401` (Req 1.2, 1.3, 1.4).

**JwtStrategy change (Req 2.5):** include the `workspaceId` claim in the returned principal so the
context guard can read it. This is the only change to the strategy.

```ts
async validate(payload: { sub: string; email: string; workspaceId?: string | null }) {
  const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, name: true }});
  if (!user) throw new UnauthorizedException(...);
  return { ...user, tokenWorkspaceId: payload.workspaceId ?? null };
}
```

### 2. `WorkspaceContextGuard` (Req 2, 3)

Resolves the request authorization context and attaches it to the request. This is the **single
source** of `Active_Workspace` and `Role`; nothing downstream reads workspace/identity from client
input.

```ts
export interface AuthContext {
  userId: string;       // = JWT sub (Req 2.1)
  workspaceId: string;  // membership-verified Active_Workspace (Req 2.2, 3.1)
  role: Role;           // verified TeamMember.role (Req 2.5)
}

@Injectable()
export class WorkspaceContextGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (isPublic(ctx, this.reflector)) return true;
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.id;                 // from JWT sub only (Req 2.1)
    const candidate = req.user?.tokenWorkspaceId; // from JWT claim only (Req 2.2)
    if (!userId || !candidate) throw new UnauthorizedException(); // (Req 2.6)

    let membership;
    try {
      membership = await this.prisma.teamMember.findUnique({
        where: { workspaceId_userId: { workspaceId: candidate, userId } }, // authoritative store (Req 3.1)
        select: { workspaceId: true, role: true },
      });
    } catch {
      throw new InternalServerErrorException(); // db failure → 500 (Req 3.5)
    }
    if (!membership) throw new MembershipDeniedException(userId, candidate); // 403 (Req 3.2)

    req.authContext = { userId, workspaceId: membership.workspaceId, role: membership.role };
    return true;
  }
}
```

Key properties: the workspace used downstream is always one the principal holds membership in
(Req 3.4), and any `workspaceId`/`userId` supplied in query/path/body is simply never read, so it is
ignored without error (Req 2.3, 2.4).

> Multi-workspace note: the JWT carries a single `workspaceId` (set at login to the user's default
> membership). `Active_Workspace` is therefore that claim, always re-verified against `TeamMember`.
> Switching workspaces is out of scope for this hardening pass; if added later, the switch endpoint
> re-issues a JWT with the new claim and the same membership verification applies unchanged.

### 3. Param decorators (Req 2.5)

```ts
export const CurrentUser    = createParamDecorator((_, c) => ctx(c).authContext.userId);
export const ActiveWorkspace= createParamDecorator((_, c) => ctx(c).authContext.workspaceId);
export const CurrentRole    = createParamDecorator((_, c) => ctx(c).authContext.role);
```

Controllers replace `@Query('workspaceId') workspaceId: string` with `@ActiveWorkspace() workspaceId: string`.
Example migration of `TemplatesController`:

```ts
@Get()
async findAll(@ActiveWorkspace() workspaceId: string) {       // was @Query('workspaceId')
  return this.templatesService.findAll(workspaceId);
}
```

### 4. `RolesGuard` + `@RequireRole(...)` + `PermissionMatrix` (Req 6, 7, 8)

```ts
export const ROLES_KEY = 'requiredRoles';
export const RequireRole = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

`RolesGuard` reads `req.authContext.role` (never client input). If a handler/class declares
`@RequireRole(...)` and the role is not in the allowed set, it throws `RoleDeniedException` → 403
(Req 6.3, 6.7). With no metadata it allows (read endpoints).

The matrix is centralized as pure data/logic so it can be unit- and property-tested in isolation:

```ts
// modules/auth/authorization/permission-matrix.ts
export type Action =
  | 'content.create' | 'content.update' | 'content.delete'
  | 'post.publish'   | 'approval.review'
  | 'social.connect' | 'social.disconnect';

export const PermissionMatrix: Record<Action, Role[]> = {
  'content.create':    ['owner', 'editor'],            // Req 6.2
  'content.update':    ['owner', 'editor'],            // Req 6.2
  'content.delete':    ['owner', 'editor'],            // Req 6.5
  'post.publish':      ['owner', 'editor'],            // Req 6.6
  'approval.review':   ['owner', 'approver'],          // Req 6.4, 7.3
  'social.connect':    ['owner', 'editor'],            // Req 8.3
  'social.disconnect': ['owner', 'editor'],            // Req 8.6
};
export const can = (action: Action, role: Role) =>
  role === 'owner' || PermissionMatrix[action].includes(role); // owner ⇒ all (Req 6.1)
```

Applied at the handler, e.g.:

```ts
@Post()  @RequireRole('owner', 'editor')          // create template (Req 6.2)
@Delete(':id') @RequireRole('owner', 'editor')    // (Req 6.5)
@Patch(':id/review') @RequireRole('owner', 'approver') // approval (Req 7.3)
@Post('disconnect')  @RequireRole('owner', 'editor')   // (Req 8.6)
```

`viewer` appears in no allow-list, so every mutating action rejects `viewer` with 403 (Req 6.3).

### 5. `TenantScopeService` — resolve-or-404 ownership (Req 5, 7.2, 8.5, 8.7)

A small helper that all services use for access-by-id and batch checks. It encapsulates the
indistinguishable-404 rule and produces the audit-distinguishing exception only on the deny path.

```ts
@Injectable()
export class TenantScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve a single resource within the active workspace, or throw a 404 that is
   *  identical in shape whether the id is cross-tenant or genuinely absent (Req 5.2, 5.3, 9.3). */
  async requireOwned<T>(args: {
    findScoped: () => Promise<T | null>;     // e.g. prisma.post.findFirst({ where:{ id, workspaceId } })
    findUnscopedExists: () => Promise<boolean>; // e.g. prisma.post exists by id (any workspace)
    workspaceId: string; resourceType: string; resourceId: string;
  }): Promise<T> {
    let scoped: T | null;
    try { scoped = await args.findScoped(); }
    catch { throw new InternalServerErrorException(); } // Req 5.4
    if (scoped) return scoped;

    // Deny path only: distinguish cross-tenant (audited) from absent (not audited),
    // while returning an identical 404 body for both (Req 9.3, 9.5).
    const existsElsewhere = await args.findUnscopedExists();
    if (existsElsewhere) {
      throw new CrossTenantNotFoundException(args.resourceType, args.resourceId, args.workspaceId); // Req 5.2
    }
    throw new NotFoundException(); // genuine miss (Req 5.3)
  }

  /** All-or-nothing batch check for mutations referencing many ids (Req 5.5, 8.5, 8.7). */
  async requireAllOwned(ids: string[], opts: {...}): Promise<void> { /* count owned == ids.length else throw */ }
}
```

Transitive ownership is expressed through Prisma relation filters (no schema change needed), e.g.:

| Resource | `findScoped` predicate |
|---|---|
| Post, Campaign, Template, HashtagSet, SocialAccount, RSSSource | `{ id, workspaceId }` |
| Schedule | `{ id, post: { workspaceId } }` |
| Analytics | `{ scheduleId, schedule: { post: { workspaceId } } }` |
| PostVersion, MediaAsset, ApprovalRequest | `{ id, post: { workspaceId } }` |
| InboxMessage | `{ id, socialAccount: { workspaceId } }` |
| Notification (user-scoped) | `{ id, userId }` (Req 4.4) |

Services also become workspace-scoped for **all** queries (Req 3.3, 4.1, 4.2). Example
`TemplatesService.create/findAll` change:

```ts
create(workspaceId: string, dto: CreateTemplateDto)       // workspaceId from @ActiveWorkspace, not dto
  => prisma.template.create({ data: { ...dto, workspaceId }});
findAll(workspaceId: string)
  => prisma.template.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }});
findOne(workspaceId, id) => tenantScope.requireOwned({ findScoped: () =>
  prisma.template.findFirst({ where: { id, workspaceId }}), ... });
```

Aggregates (analytics dashboard/heatmap/stats, unread counts) add the same workspace filter to every
underlying query and return zero/empty when no rows match (Req 4.2).

### 6. Social connect/callback (Req 8.2)

- `connect/:platform` and `direct-connect`: drop `@Query('workspaceId')`; associate the new
  `SocialAccount` with `@ActiveWorkspace()` and require `@RequireRole('owner','editor')`.
- OAuth `callback/:platform` (public): the workspace is the **signed `state`** the API issued in
  `getAuthRedirectUrl` (which is created from the authenticated `connect` call's `ActiveWorkspace`).
  The fallback `state || 'default_workspace_id'` is removed; an absent/invalid `state` fails the
  callback rather than defaulting to a fabricated workspace.

### 7. Worker tenant isolation (Req 10)

A pure resolver added to `apps/worker` (mirrors the API's logic but DB-only):

```ts
// apps/worker/src/queue/resolve-workspace.ts
export type Resolution =
  | { ok: true; workspaceId: string }
  | { ok: false; reason: 'unresolvable' | 'cross_workspace_mismatch' };

export async function resolveOwningWorkspace(prisma, scheduleId: string): Promise<Resolution> {
  let schedule;
  try {
    schedule = await prisma.schedule.findUnique({
      where: { id: scheduleId },
      include: { post: { select: { workspaceId: true } }, socialAccount: { select: { workspaceId: true } } },
    });
  } catch { return { ok: false, reason: 'unresolvable' }; }      // db failure (Req 10.4)
  if (!schedule) return { ok: false, reason: 'unresolvable' };    // missing (Req 10.4)
  const a = schedule.post?.workspaceId, b = schedule.socialAccount?.workspaceId;
  if (!a || !b) return { ok: false, reason: 'unresolvable' };
  if (a !== b) return { ok: false, reason: 'cross_workspace_mismatch' }; // (Req 10.3)
  return { ok: true, workspaceId: a };
}
```

The job processor calls this first. On `{ ok: false }` it mutates nothing, marks the schedule/post
failed, throws to mark the BullMQ job failed, and writes a failure `AuditLog` record identifying the
job and the reason (Req 10.3, 10.4). The job's `job.data` workspace hint (if any) is never read for
access decisions (Req 10.5). On success, every read/write uses the resolved `workspaceId`.

### 8. Typed exceptions + `AuthorizationAuditFilter` (Req 9, 11)

```ts
class MembershipDeniedException  extends ForbiddenException  { meta: { userId, workspaceId, outcome:'membership_denied' } }
class RoleDeniedException        extends ForbiddenException  { meta: { userId, workspaceId, action, outcome:'role_denied' } }
class CrossTenantNotFoundException extends NotFoundException { meta: { userId?, workspaceId, resourceType, resourceId, outcome:'cross_tenant_denied' } }
```

`CrossTenantNotFoundException` **renders the same body** as a plain `NotFoundException` (the carried
`meta` is used only for the audit, never serialized into the response), guaranteeing
indistinguishability (Req 9.3, 9.5).

`AuthorizationAuditFilter` (a NestJS `ExceptionFilter` registered after `AllExceptionsFilter`)
catches exactly these three typed exceptions and writes **one** `AuditLog` row, then delegates to the
normal response path:

```ts
@Catch(MembershipDeniedException, RoleDeniedException, CrossTenantNotFoundException)
class AuthorizationAuditFilter implements ExceptionFilter {
  async catch(ex, host) {
    try { await this.audit.recordDenial(ex.meta, host.getRequest()); } // exactly one entry (Req 11.1, 11.2)
    catch (e) { this.logger.error(...); }                              // failure must not grant access (Req 11.4)
    // always send the original 401/403/404 response, no resource data (Req 11.4)
  }
}
```

`recordDenial` writes only ids/action/resource-type/workspace/outcome/timestamp — it never reads or
includes decrypted tokens or resource field values (Req 11.3).

## Data Models

No changes to tenancy relationships are required — every tenant-scoped resource already references
`workspaceId` directly or via FKs (see the `TenantScopeService` table). The only schema change is to
make the existing `AuditLog` model carry structured denial fields. All new columns are **nullable**,
so the migration is additive and backward-compatible (the prior image and existing `auditLog.create`
calls in `AuthService`/worker keep working unchanged) (Req 11, rollout).

```prisma
model AuditLog {
  id           String   @id @default(uuid())
  userId       String?
  user         User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  action       String                       // existing: e.g. 'login', and new e.g. 'templates.create'
  details      String   @db.Text            // existing free text (no tokens/field values)
  ipAddress    String?
  userAgent    String?
  // --- new, nullable, additive (Req 11.1, 11.2) ---
  workspaceId  String?                       // Active_Workspace at denial time
  resourceType String?                       // target resource type (e.g. 'Post')
  resourceId   String?                       // referenced id (cross-tenant 404 only, Req 11.2)
  outcome      String?                       // 'membership_denied' | 'role_denied' | 'cross_tenant_denied'
  createdAt    DateTime @default(now())

  @@index([userId, action])
  @@index([createdAt])
  @@index([workspaceId, outcome])            // new: query denials per workspace
  @@map("audit_logs")
}
```

`AuthContext` (in-memory, request-scoped only; not persisted):

```ts
interface AuthContext { userId: string; workspaceId: string; role: Role; }
```

No decrypted token or resource field value is ever stored on an `AuditLog` denial row (Req 11.3).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a
system — essentially, a formal statement about what the system should do. Properties serve as the
bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The requirements explicitly tag several criteria `(property)` (3.4, 4.3, 5.6, 6.7, 9.5, 10.5). The
properties below derive from the prework analysis and have been consolidated to remove redundancy:
many criteria collapse into the same universal invariant (e.g. all the per-role/per-action RBAC
clauses are one matrix property; all the cross-tenant read clauses are one isolation property).

### Property 1: Server-derived identity and workspace

*For any* request that reaches a handler and *for any* client-supplied `userId`/`workspaceId` value
placed in the query string, path, or body, the resolved authorization context's `userId` equals the
JWT `sub` and the resolved `workspaceId` equals the membership-verified JWT `workspaceId` claim; the
supplied values never change the resolved context and never cause an error for the mismatch.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

### Property 2: Membership gates every authorized request

*For any* (user, workspace) pair, the request proceeds to the handler if and only if a `TeamMember`
record exists for that pair; whenever a handler executes, a `TeamMember` record exists for the
resolved (`userId`, `workspaceId`); and when no membership exists the request is rejected with 403
and no data access or mutation occurs.

**Validates: Requirements 3.1, 3.2, 3.4**

### Property 3: Reads return only active-scope records

*For any* multi-tenant dataset and *for any* resolved scope (a workspace the principal is a member
of, or the principal's own user id for user-scoped resources), a collection read returns exactly the
records whose owning scope equals the resolved scope, an aggregate read is computed only from those
records, and both return an empty/zero result when no such records exist — regardless of any query,
path, or body value. In particular, for any principal and any workspace `W` the principal is not a
member of, no read returns a record owned by `W`.

**Validates: Requirements 3.3, 4.1, 4.2, 4.3, 4.4, 7.5, 8.1**

### Property 4: Resource-by-id isolation is indistinguishable from not-found

*For any* principal and *for any* resource id whose owning workspace is not the active workspace, a
request referencing that id neither returns the resource's data nor modifies it, and produces a
response whose HTTP status code and body are identical to the response for a genuinely non-existent
id; both responses contain no resource field values and no signal indicating whether the resource
exists.

**Validates: Requirements 5.1, 5.2, 5.3, 5.6, 7.2, 9.3, 9.4, 9.5**

### Property 5: Multi-id mutations are all-or-nothing

*For any* set of resource ids referenced by a single mutating request, the mutation is applied if
and only if every referenced id exists and resolves to the active workspace; if any id is absent or
cross-tenant, no referenced resource is modified and the request is rejected with 404.

**Validates: Requirements 5.5, 8.5, 8.7**

### Property 6: Parent-reference validation on create

*For any* create request that references parent resources (e.g. a Post referencing a SocialAccount
or Campaign), the resource is created if and only if every referenced parent exists and its owning
workspace equals the active workspace; otherwise no resource is created and the request is rejected
with 404.

**Validates: Requirements 5.7, 5.8**

### Property 7: RBAC permission matrix is enforced

*For any* (action, role) pair, a guarded endpoint for that action allows the request if and only if
the `PermissionMatrix` permits the role for that action (with `owner` permitted every action); when
the matrix denies the role the endpoint responds with 403 and performs no create, update, delete,
publish, approve, or reject — regardless of request input.

**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.3, 7.4, 8.3, 8.4, 8.6**

### Property 8: Connect associates the active workspace

*For any* social-account connect (OAuth connect, OAuth callback via signed state, or direct token
connect) and *for any* supplied workspace hint, the created `SocialAccount`'s `workspaceId` equals
the active workspace derived from verified membership (or, for the callback, the workspace encoded in
the signed `state` the API issued) and never a client-supplied value or a default fallback.

**Validates: Requirements 8.2**

### Property 9: Worker resolves tenancy from stored foreign keys only

*For any* job and *for any* workspace hint present in the job payload, the worker's resolved owning
workspace is a function only of the resources' stored foreign keys: it proceeds if and only if every
referenced resource resolves to the same workspace; if the foreign-key workspaces differ it halts
without cross-workspace access, marks the job failed, and records a cross-workspace-mismatch failure;
if a referenced resource is missing or resolution fails it halts, marks the job failed, and records a
resolution failure; the payload hint never affects the outcome.

**Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**

### Property 10: Exactly one redacted audit entry per denial

*For any* request denied by a membership or role check (403) or by a cross-tenant ownership check
(404), the API records exactly one `AuditLog` entry containing the principal user identity, the
attempted action and target resource type, the active workspace, the denial outcome, and a timestamp
(plus the referenced resource id for cross-tenant 404), and the entry contains no decrypted token and
no resource field value.

**Validates: Requirements 11.1, 11.2, 11.3**

## Error Handling

The decision pipeline produces exactly one of these outcomes, realized through NestJS exceptions and
filters so semantics are consistent everywhere (Req 9):

| Stage | Condition | Exception | HTTP | Audited? | Body |
|---|---|---|---|---|---|
| Authentication | missing/expired/malformed/bad-sig/`sub` not found | `UnauthorizedException` (passport) | 401 | no | generic |
| Workspace resolve | claim absent / unresolvable | `UnauthorizedException` | 401 | no | generic |
| Membership | no `TeamMember` row | `MembershipDeniedException` | 403 | yes | generic |
| Membership/ownership | DB/infra failure | `InternalServerErrorException` | 500 | no | generic |
| Role | matrix denies role | `RoleDeniedException` | 403 | yes | generic |
| Ownership (by id) | cross-tenant reference | `CrossTenantNotFoundException` | 404 | yes | **identical to plain 404** |
| Ownership (by id) | genuinely absent | `NotFoundException` | 404 | no | plain 404 |

Rules enforced by ordering and filters:

- **Strict short-circuit (Req 9.1, 9.2):** guards run auth → membership → role; a failure at any
  stage throws immediately, so later stages and the service/data layer are never reached. Ownership
  checks live inside services, which only run after all guards pass.
- **Indistinguishable 404 (Req 9.3, 9.5):** `CrossTenantNotFoundException` extends `NotFoundException`
  and serializes the identical default body. The distinguishing metadata is attached as a
  non-enumerable property used only by the audit filter, never serialized.
- **No leakage (Req 9.4):** all 401/403/404 bodies use Nest's default generic shape; services never
  place resource fields into error responses.
- **Audit resilience (Req 11.4):** `AuthorizationAuditFilter` wraps the `AuditLog` write in
  try/catch; a write failure is logged and the original 401/403/404 is still returned. Access is
  never granted as a side effect of audit success or failure (the response is the rejection either
  way).
- **Worker failures (Req 10.3, 10.4):** an unresolvable or cross-workspace job throws after marking
  the schedule/post `failed` and writing a failure `AuditLog`; BullMQ records the job failure. The
  existing retry/dead-letter handling in `publish.worker.ts` is reused unchanged.

## Testing Strategy

PBT **is** appropriate for this feature: the permission matrix, tenant scoping, indistinguishable-404
logic, multi-id atomicity, and worker workspace resolution are pure, input-varying functions with
universal invariants. The I/O-bound and wiring concerns (guard registration, 401 semantics,
infra-failure 500s, audit-write resilience) are covered by example/integration/edge tests.

### Tooling and conventions

- **Property library:** `fast-check` with Jest (matching the convention established by the
  `saas-production-deployment` spec — do not hand-roll generators). Add `fast-check` as a dev
  dependency in `apps/api` (and `apps/worker` for Property 9).
- **Minimum 100 iterations** per property test (`fc.assert(fc.property(...), { numRuns: 100 })`).
- Each property test is a **single** test tagged:
  `// Feature: workspace-authorization, Property {n}: {property_text}`.
- Pure logic (matrix, resolver, indistinguishability comparison) is tested against extracted pure
  functions; data-scoping properties run against an in-memory fake of the Prisma calls used
  (`findFirst`/`findMany`/`count`) seeded with multi-tenant fixtures, so the 100+ iterations stay
  fast and deterministic without a live database.

### Property test plan (highest value first)

- **Property 7 (RBAC matrix)** — generate every `(action, role)`; assert `can()` matches the matrix
  and that the guard maps deny → 403 with the handler spy never invoked. Pure + trivial.
- **Property 9 (worker resolution)** — generate schedules with FK workspace pairs (equal/unequal),
  missing resources, and arbitrary payload hints over a fake prisma; assert proceed iff equal, halt +
  recorded failure otherwise, hint ignored.
- **Property 1 (server-derived identity)** — generate arbitrary supplied `userId`/`workspaceId`;
  assert resolved context depends only on JWT + membership.
- **Property 2 (membership gating)** — generate membership/non-membership; assert proceed iff member
  and 403 + no data call otherwise.
- **Property 3 (read isolation)** — generate records across many workspaces/users; assert every read
  returns exactly the active-scope subset (direct, transitive, user-scoped) and empty when none.
- **Property 4 (indistinguishable 404)** — generate ids that are owned/cross-tenant/absent; assert
  cross-tenant and absent responses deep-equal (status + body) and no mutation/read of the resource.
- **Property 5 (multi-id atomicity)** — generate id sets mixing owned/cross-tenant/absent; assert
  mutation applied iff all owned, else zero rows changed.
- **Property 6 (parent-ref on create)** — generate parent refs across workspaces; assert create iff
  all parents in active workspace.
- **Property 8 (connect association)** — generate connect inputs with arbitrary workspace hints;
  assert created account's `workspaceId` == active workspace.
- **Property 10 (audit on denial)** — generate denied requests across outcomes; assert exactly one
  `AuditLog` row with the required fields and no token/field-value content.

### Unit / example / edge tests

- 401 semantics: missing, expired, malformed, bad-signature, and `sub`-not-found tokens → 401
  (Req 1.1–1.4, 1.6).
- Guard coverage (Req 1.5): enumerate the router and assert every posts/analytics/social-auth/
  campaigns/templates/inbox/notifications/approvals/media route rejects an unauthenticated request.
- Decorator contract (Req 2.5): handler reading `@CurrentUser/@ActiveWorkspace/@CurrentRole` receives
  the resolved context.
- Short-circuit ordering (Req 9.1, 9.2): spies confirm that on 401 the membership/role/ownership
  collaborators are never called, and on 403 the ownership/data layer is never called.
- Infra-failure 500s (Req 2.6, 3.5, 5.4): mock Prisma to throw → 500 with no data access/mutation.
- Approval happy path (Req 7.1): in-workspace post → ApprovalRequest created.
- Audit-write resilience (Req 11.4): force the `AuditLog` write to throw → original 403/404 still
  returned, no resource data in the body.
- Migration check: applying the additive `AuditLog` migration leaves existing `auditLog.create` call
  sites (AuthService, worker) working unchanged.

## Migration and Rollout Strategy

The change is surgical and backward-compatible, applied so existing authenticated flows never break:

1. **Foundation (no behavior change):** add `@Public()`, the `WorkspaceContextGuard`,
   `RolesGuard`, the param decorators, `TenantScopeService`, the typed exceptions, and the
   `AuthorizationAuditFilter`. Update `JwtStrategy.validate` to surface `tokenWorkspaceId`. Run the
   additive `AuditLog` migration (all new columns nullable). None of this is wired globally yet.
2. **Enable auth globally with explicit opt-outs:** register `JwtAuthGuard` via `APP_GUARD` and mark
   `login`, `register`, `supabase-sync`, OAuth `callback`, and `health` as `@Public()`. This closes
   the unauthenticated-controller gap (Req 1) in one step; verify each protected route now returns
   401 unauthenticated.
3. **Roll out workspace scoping module-by-module:** for each module (templates → social-auth →
   posts → campaigns → analytics → inbox → approvals → notifications → media), replace
   `@Query('workspaceId')` with `@ActiveWorkspace()`, push the `workspaceId` argument into every
   service query, convert `findUnique`-by-id reads/mutations to `TenantScopeService.requireOwned`,
   and add `@RequireRole(...)` to mutating handlers per the matrix. Each module ships and is verified
   independently, limiting blast radius.
4. **Worker isolation:** add `resolveOwningWorkspace` and call it at the top of the publish job;
   ignore any payload workspace hint.
5. **Client compatibility (web):** per Req 2.3 the API **ignores** any `workspaceId` query param
   rather than rejecting it, so the existing Next.js client keeps working during rollout even while
   it still sends the param. The client is then updated to stop sending `workspaceId` as a separate
   follow-up; no coordinated big-bang deploy is required. The OAuth `callback` `'default_workspace_id'`
   fallback is removed — the workspace comes from the signed `state` issued by the authenticated
   connect call.

This ordering keeps the system releasable at every step: authentication is hardened first, then each
module's tenant isolation is added behind already-verified identity, and the worker is isolated last.
