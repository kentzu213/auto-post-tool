import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  CrossTenantNotFoundMeta,
  MembershipDeniedMeta,
  RoleDeniedMeta,
} from './authorization.exceptions';

/**
 * The denial metadata carried (non-enumerably) by the typed authorization
 * exceptions. It is the ONLY input the audit path reads from the exception, so the
 * audit row can never contain a decrypted token or a resource field value (Req 11.3).
 */
export type DenialMeta =
  | MembershipDeniedMeta
  | RoleDeniedMeta
  | CrossTenantNotFoundMeta;

/**
 * Minimal structural shape of the HTTP request needed to compose the audited
 * action. Typed loosely so the service does not depend on Express types and never
 * reaches into request bodies/headers (which could carry secrets).
 */
interface AuditableRequest {
  method?: string;
  route?: { path?: string };
  url?: string;
}

/**
 * Writes a single redacted `AuditLog` entry for a denied authorization request
 * (Req 11.1, 11.2, 11.3).
 *
 * Only ids, the composed action, the target resource type, the active workspace, the
 * denial outcome, and a timestamp are persisted. The referenced resource id is stored
 * only for a cross-tenant 404. No decrypted token and no resource field value is ever
 * read or written here (Req 11.3): the service derives everything from the typed
 * exception's `meta` and the request method/route, never from the request body.
 */
@Injectable()
export class AuthorizationAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record EXACTLY ONE `AuditLog` row describing the denial (Req 11.1, 11.2).
   *
   * @param meta the denial metadata carried by the typed exception.
   * @param req  the HTTP request, used only to compose `action` from method + route.
   */
  async recordDenial(
    meta: DenialMeta,
    req: AuditableRequest | undefined,
  ): Promise<void> {
    const isCrossTenant = meta.outcome === 'cross_tenant_denied';

    await this.prisma.auditLog.create({
      data: {
        userId: meta.userId ?? null,
        action: this.composeAction(meta, req),
        // Generic, non-leaking description. Carries no token or resource field value (Req 11.3).
        details: `Authorization denied (${meta.outcome})`,
        workspaceId: meta.workspaceId,
        resourceType: isCrossTenant ? meta.resourceType : null,
        // Referenced id is recorded only for a cross-tenant 404 (Req 11.2).
        resourceId: isCrossTenant ? meta.resourceId : null,
        outcome: meta.outcome,
        // createdAt uses the model's `@default(now())` timestamp (Req 11.1, 11.2).
      },
    });
  }

  /**
   * Compose the attempted action from the request method and matched route (e.g.
   * `"POST /templates"`). The query string is stripped so no client-supplied values
   * leak into the log. Falls back to the outcome (+ resource type, when present) if
   * route information is unavailable.
   */
  private composeAction(meta: DenialMeta, req: AuditableRequest | undefined): string {
    const method = (req?.method ?? '').toUpperCase().trim();
    const path = (req?.route?.path ?? (req?.url ?? '').split('?')[0] ?? '').trim();
    const base = [method, path].filter(Boolean).join(' ').trim();
    if (base) {
      return base;
    }

    const resourceType =
      meta.outcome === 'cross_tenant_denied' ? ` ${meta.resourceType}` : '';
    return `${meta.outcome}${resourceType}`;
  }
}
