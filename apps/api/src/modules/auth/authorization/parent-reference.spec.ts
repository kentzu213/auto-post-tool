// Feature: workspace-authorization, Property 6: Parent-reference validation on create
import { NotFoundException } from '@nestjs/common';
import fc from 'fast-check';

import { CrossTenantNotFoundException } from './authorization.exceptions';
import { TenantScopeService } from './tenant-scope.service';

/**
 * Property 6 (Validates: Requirements 5.7, 5.8).
 *
 * When the posts service creates a Post that references parent resources (a Campaign
 * and/or one or more SocialAccounts), it verifies each referenced parent BEFORE
 * creating anything by calling `TenantScopeService.requireOwned` on each parent. The
 * create proceeds only after every such check resolves; the first check that throws
 * aborts the create so nothing is written (Req 5.7, 5.8).
 *
 * This models that flow against `requireOwned` directly — the same primitive the posts
 * service uses. `requireOwned` is model-agnostic: it only invokes the caller-supplied
 * `findScoped` / `findUnscopedExists` closures and never touches the injected
 * PrismaService, so the service is constructed with an empty fake
 * (`new TenantScopeService({} as any)`), as confirmed by tenant-scope.service.ts.
 *
 * Each referenced parent falls into one of three classifications:
 *  - in-workspace → `findScoped` resolves the parent      → requireOwned resolves
 *                                                            → "create proceeds".
 *  - cross-tenant → `findScoped` null, exists=true         → CrossTenantNotFoundException
 *                                                            (404) → "create rejected".
 *  - absent       → `findScoped` null, exists=false        → plain NotFoundException
 *                                                            (404) → "create rejected".
 *
 * Therefore the resource is created IFF every referenced parent is in the active
 * workspace; if ANY parent is cross-tenant or absent the create is rejected with a 404
 * and nothing is created.
 */
describe('Parent-reference validation on create — Property 6', () => {
  const service = new TenantScopeService({} as any);

  type Classification = 'in-workspace' | 'cross-tenant' | 'absent';

  const classificationArb: fc.Arbitrary<Classification> = fc.constantFrom(
    'in-workspace',
    'cross-tenant',
    'absent',
  );

  /** A single referenced parent (e.g. a Campaign or a SocialAccount). */
  const parentArb = fc.record({
    resourceType: fc.constantFrom('Campaign', 'SocialAccount'),
    resourceId: fc.string({ minLength: 1, maxLength: 12 }),
    classification: classificationArb,
  });

  type Parent = {
    resourceType: string;
    resourceId: string;
    classification: Classification;
  };

  /**
   * Models the posts service create flow: verify every referenced parent via
   * `requireOwned` (aborting on the first failure), then "create" the resource only if
   * all checks resolved. `created` is flipped to true exactly once, and only after the
   * full verification loop completes, so a rejection leaves nothing created.
   */
  async function attemptCreate(
    workspaceId: string,
    parents: Parent[],
  ): Promise<{ created: boolean; error?: unknown; checks: number }> {
    let checks = 0;
    try {
      for (const parent of parents) {
        await service.requireOwned({
          findScoped: async () => {
            checks += 1;
            return parent.classification === 'in-workspace'
              ? ({ id: parent.resourceId, workspaceId, secret: 'parent-data' } as any)
              : null;
          },
          findUnscopedExists: async () =>
            parent.classification === 'cross-tenant',
          workspaceId,
          resourceType: parent.resourceType,
          resourceId: parent.resourceId,
        });
      }
    } catch (error) {
      return { created: false, error, checks };
    }
    // Every parent verified → the create proceeds.
    return { created: true, checks };
  }

  it('creates iff every referenced parent is in the active workspace, else rejects with 404 and creates nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.array(parentArb, { maxLength: 6 }),
        async (workspaceId, parents) => {
          const allInWorkspace = parents.every(
            (p) => p.classification === 'in-workspace',
          );

          const result = await attemptCreate(workspaceId, parents);

          // Core IFF: created exactly when every parent is in the active workspace
          // (vacuously true when there are no referenced parents).
          expect(result.created).toBe(allInWorkspace);

          if (allInWorkspace) {
            expect(result.error).toBeUndefined();
            return;
          }

          // Any cross-tenant/absent parent ⇒ create rejected with a 404 and nothing
          // created (Req 5.8). The body is the indistinguishable not-found shape.
          expect(result.created).toBe(false);
          const err = result.error as NotFoundException;
          expect(err).toBeInstanceOf(NotFoundException);
          expect(err.getStatus()).toBe(404);

          // Verification stops at the first failing parent, so no parent past it is
          // checked and the rejection body leaks no parent field values.
          const firstFailingIndex = parents.findIndex(
            (p) => p.classification !== 'in-workspace',
          );
          expect(result.checks).toBe(firstFailingIndex + 1);
          expect(JSON.stringify(err.getResponse())).not.toContain('parent-data');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('classifies the first failing parent: cross-tenant → CrossTenantNotFoundException, absent → plain NotFoundException', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        // At least one non-in-workspace parent guarantees a rejection to classify.
        fc
          .array(parentArb, { minLength: 1, maxLength: 6 })
          .filter((ps) => ps.some((p) => p.classification !== 'in-workspace')),
        async (workspaceId, parents) => {
          const result = await attemptCreate(workspaceId, parents);
          expect(result.created).toBe(false);

          const firstFailing = parents.find(
            (p) => p.classification !== 'in-workspace',
          )!;
          if (firstFailing.classification === 'cross-tenant') {
            expect(result.error).toBeInstanceOf(CrossTenantNotFoundException);
          } else {
            expect(result.error).toBeInstanceOf(NotFoundException);
            expect(result.error).not.toBeInstanceOf(
              CrossTenantNotFoundException,
            );
          }
          expect((result.error as NotFoundException).getStatus()).toBe(404);
        },
      ),
      { numRuns: 100 },
    );
  });

  describe('concrete examples', () => {
    const ws = 'ws-active';

    it('no referenced parents → create proceeds (vacuously)', async () => {
      const result = await attemptCreate(ws, []);
      expect(result.created).toBe(true);
    });

    it('Campaign + SocialAccount both in-workspace → create proceeds', async () => {
      const result = await attemptCreate(ws, [
        { resourceType: 'Campaign', resourceId: 'c1', classification: 'in-workspace' },
        { resourceType: 'SocialAccount', resourceId: 's1', classification: 'in-workspace' },
      ]);
      expect(result.created).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('Campaign in-workspace but SocialAccount cross-tenant → rejected 404, nothing created', async () => {
      const result = await attemptCreate(ws, [
        { resourceType: 'Campaign', resourceId: 'c1', classification: 'in-workspace' },
        { resourceType: 'SocialAccount', resourceId: 's1', classification: 'cross-tenant' },
      ]);
      expect(result.created).toBe(false);
      expect(result.error).toBeInstanceOf(CrossTenantNotFoundException);
      expect((result.error as CrossTenantNotFoundException).getStatus()).toBe(404);
    });

    it('referenced Campaign absent → rejected 404, nothing created', async () => {
      const result = await attemptCreate(ws, [
        { resourceType: 'Campaign', resourceId: 'missing', classification: 'absent' },
        { resourceType: 'SocialAccount', resourceId: 's1', classification: 'in-workspace' },
      ]);
      expect(result.created).toBe(false);
      expect(result.error).toBeInstanceOf(NotFoundException);
      expect(result.error).not.toBeInstanceOf(CrossTenantNotFoundException);
      // Stops at the first (absent) parent; the second is never checked.
      expect(result.checks).toBe(1);
    });
  });
});
