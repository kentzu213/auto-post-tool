// Feature: workspace-authorization, Property 4: Resource-by-id isolation is indistinguishable from not-found
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import fc from 'fast-check';

import { CrossTenantNotFoundException } from './authorization.exceptions';
import { TenantScopeService } from './tenant-scope.service';

/**
 * Property 4 (Validates: Requirements 5.1, 5.2, 5.3, 5.6, 7.2, 9.3, 9.4, 9.5).
 *
 * `requireOwned` is model-agnostic: it only invokes the caller-supplied `findScoped`
 * / `findUnscopedExists` closures and never touches the injected PrismaService, so the
 * service can be constructed with an empty fake (`new TenantScopeService({} as any)`).
 * Confirmed by reading tenant-scope.service.ts: the `prisma` field is stored but unused
 * by `requireOwned`.
 *
 * The four classifications a referenced id can fall into:
 *  - owned        → `findScoped` resolves a record  → that record is returned.
 *  - cross-tenant → `findScoped` null, exists=true   → CrossTenantNotFoundException (404).
 *  - absent       → `findScoped` null, exists=false  → plain NotFoundException (404).
 *  - db-error     → `findScoped` rejects             → InternalServerErrorException (500).
 *
 * KEY (Property 4): the cross-tenant and absent responses are INDISTINGUISHABLE — same
 * HTTP status (404) and a byte-identical serialized body — so a caller cannot tell
 * whether a resource exists in another workspace or not at all.
 */
describe('TenantScopeService.requireOwned — Property 4: indistinguishable cross-tenant 404', () => {
  const service = new TenantScopeService({} as any);

  type Classification = 'owned' | 'cross-tenant' | 'absent' | 'db-error';

  const classificationArb: fc.Arbitrary<Classification> = fc.constantFrom(
    'owned',
    'cross-tenant',
    'absent',
    'db-error',
  );

  it('classifies owned/cross-tenant/absent/db-error and renders identical 404 for cross-tenant vs absent', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.string(),
        fc.string(),
        classificationArb,
        async (workspaceId, resourceId, resourceType, classification) => {
          // Sentinel record returned only on the owned path; its fields must never
          // leak into a 404 body (verified implicitly: deny paths never see it).
          const record = { id: resourceId, workspaceId, secret: 'owned-data' };

          let findScopedCalls = 0;
          let findUnscopedCalls = 0;

          const findScoped = async () => {
            findScopedCalls += 1;
            if (classification === 'db-error') {
              throw new Error('db down');
            }
            return classification === 'owned' ? (record as any) : null;
          };
          const findUnscopedExists = async () => {
            findUnscopedCalls += 1;
            return classification === 'cross-tenant';
          };

          const call = () =>
            service.requireOwned({
              findScoped,
              findUnscopedExists,
              workspaceId,
              resourceType,
              resourceId,
            });

          if (classification === 'owned') {
            const result = await call();
            // Returns the scoped record; existence-elsewhere check never runs.
            expect(result).toBe(record);
            expect(findScopedCalls).toBe(1);
            expect(findUnscopedCalls).toBe(0);
            return;
          }

          if (classification === 'db-error') {
            await expect(call()).rejects.toBeInstanceOf(
              InternalServerErrorException,
            );
            expect(findUnscopedCalls).toBe(0);
            return;
          }

          // cross-tenant OR absent: both must surface a 404.
          let thrown: unknown;
          try {
            await call();
          } catch (err) {
            thrown = err;
          }
          expect(thrown).toBeDefined();

          if (classification === 'cross-tenant') {
            expect(thrown).toBeInstanceOf(CrossTenantNotFoundException);
          } else {
            expect(thrown).toBeInstanceOf(NotFoundException);
            expect(thrown).not.toBeInstanceOf(CrossTenantNotFoundException);
          }

          // --- KEY Property 4 assertion: indistinguishability ---
          // The thrown 404 must be byte-identical to a plain NotFoundException in
          // both HTTP status and serialized body, regardless of cross-tenant vs absent.
          const ex = thrown as CrossTenantNotFoundException | NotFoundException;
          const plain = new NotFoundException();

          expect(ex.getStatus()).toBe(404);
          expect(ex.getStatus()).toBe(plain.getStatus());
          expect(JSON.stringify(ex.getResponse())).toBe(
            JSON.stringify(plain.getResponse()),
          );

          // Body carries no resource field values and no exists/not-exists signal:
          // the distinguishing data lives only in non-enumerable `meta`, never serialized.
          const serializedBody = JSON.stringify(ex.getResponse());
          expect(serializedBody).not.toContain('secret');
          expect(serializedBody).not.toContain('cross_tenant');
          expect(serializedBody).not.toContain('outcome');

          // No mutation/read of the resource beyond the single scoped lookup.
          expect(findScopedCalls).toBe(1);
          expect(findUnscopedCalls).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('cross-tenant and absent responses are pairwise equal for the same inputs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.string(),
        fc.string(),
        async (workspaceId, resourceId, resourceType) => {
          const base = {
            findScoped: async () => null,
            workspaceId,
            resourceType,
            resourceId,
          };

          const crossTenant = await service
            .requireOwned({ ...base, findUnscopedExists: async () => true })
            .then(
              () => {
                throw new Error('expected throw');
              },
              (e) => e as CrossTenantNotFoundException,
            );
          const absent = await service
            .requireOwned({ ...base, findUnscopedExists: async () => false })
            .then(
              () => {
                throw new Error('expected throw');
              },
              (e) => e as NotFoundException,
            );

          expect(crossTenant.getStatus()).toBe(absent.getStatus());
          expect(JSON.stringify(crossTenant.getResponse())).toBe(
            JSON.stringify(absent.getResponse()),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
