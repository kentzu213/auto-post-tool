import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { CrossTenantNotFoundException } from './authorization.exceptions';

/**
 * Arguments for a single resolve-or-404 ownership check (Req 5.1, 5.2, 5.3).
 *
 * The caller supplies the two queries so this helper stays model-agnostic:
 * - `findScoped` is a workspace-scoped lookup, e.g.
 *   `() => prisma.post.findFirst({ where: { id, workspaceId } })`.
 * - `findUnscopedExists` answers whether the id exists in ANY workspace, e.g.
 *   `() => prisma.post.findUnique({ where: { id } }).then(Boolean)`.
 */
export interface RequireOwnedArgs<T> {
  /** Workspace-scoped query; resolves the record only if it belongs to the active workspace. */
  findScoped: () => Promise<T | null>;
  /** Existence check across all workspaces; used only on the deny path to classify the 404. */
  findUnscopedExists: () => Promise<boolean>;
  /** Active workspace the request is operating within (for audit metadata). */
  workspaceId: string;
  /** Target resource type (e.g. 'Post'), used only for audit metadata. */
  resourceType: string;
  /** Referenced resource id, used only for audit metadata. */
  resourceId: string;
  /** Principal user identity, used only for audit metadata. */
  userId?: string;
}

/**
 * Arguments for an all-or-nothing batch ownership check (Req 5.5, 8.5, 8.7).
 *
 * The caller supplies a single workspace-scoped count query so this helper stays
 * model-agnostic, e.g.
 * `(ids) => prisma.socialAccount.count({ where: { id: { in: ids }, workspaceId } })`.
 */
export interface RequireAllOwnedOpts {
  /**
   * Counts how many of the given ids resolve to the active workspace. Receives the
   * de-duplicated id list so the returned count can be compared directly against it.
   */
  countScoped: (ids: string[]) => Promise<number>;
  /** Active workspace the request is operating within (for audit metadata). */
  workspaceId: string;
  /** Target resource type (e.g. 'SocialAccount'), used only for audit metadata. */
  resourceType: string;
  /** Principal user identity, used only for audit metadata. */
  userId?: string;
}

/**
 * Resolve-or-404 ownership helper used by services for access-by-id (Req 5).
 *
 * It centralizes the indistinguishable-404 rule: whether a referenced id is
 * cross-tenant or genuinely absent, callers receive a 404 with an identical body
 * (Req 5.2, 5.3, 9.3). The distinguishing information lives only in the typed
 * `CrossTenantNotFoundException`'s non-enumerable `meta`, which the audit filter reads
 * on the deny path — it is never serialized into the response.
 *
 * It also provides a batch `requireAllOwned` for all-or-nothing multi-id mutations
 * (task 3.4), which applies the same indistinguishable-404 and deny-path audit rules.
 */
@Injectable()
export class TenantScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a single resource within the active workspace, or throw a 404 that is
   * identical in shape whether the id is cross-tenant or genuinely absent
   * (Req 5.1, 5.2, 5.3, 9.3).
   *
   * @throws InternalServerErrorException on a DB/infra failure during the scoped lookup (Req 5.4).
   * @throws CrossTenantNotFoundException (404) when the id exists in another workspace (Req 5.2).
   * @throws NotFoundException (404) when the id does not exist anywhere (Req 5.3).
   */
  async requireOwned<T>(args: RequireOwnedArgs<T>): Promise<T> {
    let scoped: T | null;
    try {
      scoped = await args.findScoped();
    } catch {
      // DB/infra failure during ownership resolution → 500 (Req 5.4).
      throw new InternalServerErrorException();
    }
    if (scoped) {
      return scoped;
    }

    // Deny path only: distinguish cross-tenant (audited) from absent (not audited),
    // while returning an identical 404 body for both (Req 5.2, 5.3, 9.3).
    const existsElsewhere = await args.findUnscopedExists();
    if (existsElsewhere) {
      throw new CrossTenantNotFoundException(
        args.resourceType,
        args.resourceId,
        args.workspaceId,
        args.userId,
      );
    }
    throw new NotFoundException();
  }

  /**
   * All-or-nothing batch ownership check for a mutation referencing many ids
   * (Req 5.5, 8.5, 8.7). It verifies that EVERY referenced id exists AND resolves to
   * the active workspace BEFORE any mutation runs: the caller invokes this first and
   * only mutates once it returns, so a failure leaves every referenced resource
   * unchanged.
   *
   * The check is a single scoped count: after de-duplicating `ids`, it compares the
   * owned count against the number of distinct referenced ids. If they differ — because
   * an id is cross-tenant or genuinely absent — it throws a 404 whose body is identical
   * to a plain `NotFoundException`, mirroring `requireOwned`'s indistinguishable-404 and
   * deny-path audit classification (Req 9.3). An empty/de-duplicated-empty id list is a
   * no-op (nothing referenced ⇒ nothing to deny).
   *
   * @throws InternalServerErrorException on a DB/infra failure during the scoped count (Req 5.4).
   * @throws CrossTenantNotFoundException (404) when any referenced id is absent or cross-tenant (Req 5.5, 8.7).
   */
  async requireAllOwned(
    ids: string[],
    opts: RequireAllOwnedOpts,
  ): Promise<void> {
    const distinctIds = [...new Set(ids)];
    if (distinctIds.length === 0) {
      return;
    }

    let ownedCount: number;
    try {
      ownedCount = await opts.countScoped(distinctIds);
    } catch {
      // DB/infra failure during ownership resolution → 500 (Req 5.4).
      throw new InternalServerErrorException();
    }

    // All-or-nothing: unless every distinct referenced id resolves to the active
    // workspace, reject with a 404 identical in shape to a genuine not-found so no
    // referenced resource is changed (Req 5.5, 8.5, 8.7).
    if (ownedCount !== distinctIds.length) {
      throw new CrossTenantNotFoundException(
        opts.resourceType,
        distinctIds.join(','),
        opts.workspaceId,
        opts.userId,
      );
    }
  }
}
