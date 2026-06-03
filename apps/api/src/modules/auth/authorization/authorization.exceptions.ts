import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { Action } from './permission-matrix';

/**
 * Typed authorization exceptions (Req 9.2, 9.3, 9.4).
 *
 * Each exception carries a `meta` object describing the denial, used ONLY by the
 * `AuthorizationAuditFilter` to write a single redacted `AuditLog` entry (task 4.2).
 * `meta` is attached as a NON-ENUMERABLE property so it is never serialized into the
 * HTTP response body: the response stays byte-identical to the plain Nest exception
 * (`ForbiddenException` / `NotFoundException`), preserving the non-leaking and
 * indistinguishable-404 guarantees (Req 9.3, 9.4, 9.5).
 *
 * None of these constructors pass a custom message to `super(...)`, so the serialized
 * body uses Nest's default generic shape (e.g. `{ statusCode, message, error }`).
 */

export type DenialOutcome =
  | 'membership_denied'
  | 'role_denied'
  | 'cross_tenant_denied';

/** Audit metadata for a failed membership check (Req 11.1). */
export interface MembershipDeniedMeta {
  userId: string;
  workspaceId: string;
  outcome: 'membership_denied';
}

/** Audit metadata for a failed role check (Req 11.1). */
export interface RoleDeniedMeta {
  userId: string;
  workspaceId: string;
  /**
   * The attempted action, when known. `RolesGuard` enforces by required roles
   * (per the design's `@RequireRole(...roles)` signature) and does not carry an
   * `Action`, so it is optional; the audit filter derives the action/resource
   * type from the request route when absent.
   */
  action?: Action;
  outcome: 'role_denied';
}

/** Audit metadata for a cross-tenant ownership failure (Req 11.2). */
export interface CrossTenantNotFoundMeta {
  userId?: string;
  workspaceId: string;
  resourceType: string;
  resourceId: string;
  outcome: 'cross_tenant_denied';
}

/**
 * Attaches `meta` as a non-enumerable, read-only property so it is available to the
 * audit filter but is never picked up by serialization (`JSON.stringify`, spreads, or
 * Nest's response rendering).
 */
function attachMeta<T extends object>(target: object, meta: T): void {
  Object.defineProperty(target, 'meta', {
    value: meta,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/**
 * 403 raised when the principal holds no `TeamMember` membership for the active
 * workspace (Req 3.2, 9.2). Body is identical to a plain `ForbiddenException`.
 */
export class MembershipDeniedException extends ForbiddenException {
  readonly meta!: MembershipDeniedMeta;

  constructor(userId: string, workspaceId: string) {
    super();
    attachMeta<MembershipDeniedMeta>(this, {
      userId,
      workspaceId,
      outcome: 'membership_denied',
    });
  }
}

/**
 * 403 raised when the principal's role is not permitted the attempted action by the
 * `PermissionMatrix` (Req 6.3, 6.7, 9.2). Body is identical to a plain
 * `ForbiddenException`; the attempted `action` is carried only in `meta` for audit.
 */
export class RoleDeniedException extends ForbiddenException {
  readonly meta!: RoleDeniedMeta;

  constructor(userId: string, workspaceId: string, action?: Action) {
    super();
    attachMeta<RoleDeniedMeta>(this, {
      userId,
      workspaceId,
      action,
      outcome: 'role_denied',
    });
  }
}

/**
 * 404 raised when a referenced resource exists but belongs to another workspace
 * (Req 5.2, 9.3). It extends `NotFoundException` and passes NO custom message, so the
 * serialized response body is byte-identical to a genuine `NotFoundException`, making a
 * cross-tenant reference indistinguishable from a non-existent id (Req 9.3, 9.5). The
 * distinguishing metadata lives only in the non-enumerable `meta` used by the audit
 * filter (Req 11.2).
 */
export class CrossTenantNotFoundException extends NotFoundException {
  readonly meta!: CrossTenantNotFoundMeta;

  constructor(
    resourceType: string,
    resourceId: string,
    workspaceId: string,
    userId?: string,
  ) {
    super();
    attachMeta<CrossTenantNotFoundMeta>(this, {
      userId,
      workspaceId,
      resourceType,
      resourceId,
      outcome: 'cross_tenant_denied',
    });
  }
}
