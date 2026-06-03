import fc from 'fast-check';
import {
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';

import { TenantScopeService } from './tenant-scope.service';
import { CrossTenantNotFoundException } from './authorization.exceptions';

// Feature: workspace-authorization, Property 5: Multi-id mutations are all-or-nothing

/**
 * `requireAllOwned(ids, opts)` is the all-or-nothing batch ownership gate a caller
 * invokes BEFORE running any multi-id mutation. Because the caller only mutates once
 * this resolves, "no mutation happens on failure" is modeled by asserting the call
 * REJECTS (throws) before any mutation would run. The service:
 *   - de-duplicates `ids` and treats an empty distinct set as a no-op (resolves),
 *   - calls `countScoped(distinctIds)` and resolves iff the owned count equals the
 *     number of distinct referenced ids (every id is owned),
 *   - otherwise throws a 404 so no referenced resource is changed,
 *   - maps a `countScoped` failure to a 500.
 */
const WORKSPACE_ID = 'ws-active';

function makeService(): TenantScopeService {
  return new TenantScopeService({} as any);
}

function makeOpts(countScoped: (ids: string[]) => Promise<number>) {
  return {
    countScoped,
    workspaceId: WORKSPACE_ID,
    resourceType: 'SocialAccount',
    userId: 'user-1',
  };
}

/** Captures a thrown value from an async call without failing the test runner. */
async function captureThrow(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    return err;
  }
}

describe('TenantScopeService.requireAllOwned (all-or-nothing multi-id mutations)', () => {
  // A pool of distinct candidate ids, each independently marked owned/not-owned
  // (not-owned models cross-tenant or absent ids). The referenced `ids` array is
  // sampled from the pool, intentionally allowing duplicates and arbitrary order so
  // the service's de-duplication is exercised.
  const scenarioArb = fc
    .uniqueArray(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 12 }),
        owned: fc.boolean(),
      }),
      { selector: (r) => r.id, minLength: 1, maxLength: 10 },
    )
    .chain((pool) =>
      fc.record({
        pool: fc.constant(pool),
        ids: fc.array(fc.constantFrom(...pool.map((p) => p.id)), {
          maxLength: 20,
        }),
      }),
    );

  it('resolves iff every distinct referenced id is owned, else rejects with 404 (no mutation)', async () => {
    // Validates: Requirements 5.5, 8.5, 8.7
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ pool, ids }) => {
        const ownedSet = new Set(
          pool.filter((p) => p.owned).map((p) => p.id),
        );
        // countScoped returns the number of DISTINCT owned ids it is asked about.
        const countScoped = jest.fn(async (passed: string[]) =>
          passed.filter((id) => ownedSet.has(id)).length,
        );

        const service = makeService();
        const distinct = [...new Set(ids)];
        const everyOwned = distinct.every((id) => ownedSet.has(id));

        if (everyOwned) {
          // All referenced ids owned (including the empty no-op) → resolves.
          await expect(
            service.requireAllOwned(ids, makeOpts(countScoped)),
          ).resolves.toBeUndefined();
        } else {
          // At least one referenced id is cross-tenant/absent → rejects with a 404,
          // meaning the caller never proceeds to mutate (all-or-nothing).
          const err = await captureThrow(() =>
            service.requireAllOwned(ids, makeOpts(countScoped)),
          );
          expect(err).toBeInstanceOf(HttpException);
          expect((err as HttpException).getStatus()).toBe(404);
        }

        // De-dup contract: countScoped is consulted exactly once with the distinct
        // id set, and skipped entirely when there is nothing referenced (no-op).
        if (distinct.length === 0) {
          expect(countScoped).not.toHaveBeenCalled();
        } else {
          expect(countScoped).toHaveBeenCalledTimes(1);
          const arg = countScoped.mock.calls[0][0];
          expect(new Set(arg).size).toBe(arg.length); // no duplicates passed
          expect([...arg].sort()).toEqual([...distinct].sort());
        }
      }),
      { numRuns: 200 },
    );
  });

  it('maps a countScoped (DB) failure to a 500 for any non-empty id set', async () => {
    // Validates: Requirements 5.5 (resolve-or-error), 8.5
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 12 }), {
          minLength: 1,
          maxLength: 20,
        }),
        async (ids) => {
          const countScoped = jest.fn(async () => {
            throw new Error('db down');
          });
          const service = makeService();

          const err = await captureThrow(() =>
            service.requireAllOwned(ids, makeOpts(countScoped)),
          );
          expect(err).toBeInstanceOf(InternalServerErrorException);
          expect((err as InternalServerErrorException).getStatus()).toBe(500);
        },
      ),
      { numRuns: 100 },
    );
  });

  describe('concrete examples', () => {
    it('empty ids array is a no-op: resolves and never queries', async () => {
      const countScoped = jest.fn(async () => 0);
      const service = makeService();
      await expect(
        service.requireAllOwned([], makeOpts(countScoped)),
      ).resolves.toBeUndefined();
      expect(countScoped).not.toHaveBeenCalled();
    });

    it('all ids owned → resolves', async () => {
      const owned = new Set(['a', 'b', 'c']);
      const countScoped = jest.fn(async (ids: string[]) =>
        ids.filter((id) => owned.has(id)).length,
      );
      const service = makeService();
      await expect(
        service.requireAllOwned(['a', 'b', 'c'], makeOpts(countScoped)),
      ).resolves.toBeUndefined();
    });

    it('duplicate owned ids → resolves and de-dupes before counting', async () => {
      const owned = new Set(['a', 'b']);
      const countScoped = jest.fn(async (ids: string[]) =>
        ids.filter((id) => owned.has(id)).length,
      );
      const service = makeService();
      await expect(
        service.requireAllOwned(['a', 'a', 'b', 'b', 'a'], makeOpts(countScoped)),
      ).resolves.toBeUndefined();
      expect([...countScoped.mock.calls[0][0]].sort()).toEqual(['a', 'b']);
    });

    it('one cross-tenant/absent id → throws CrossTenantNotFoundException (404), no mutation', async () => {
      const owned = new Set(['a', 'b']); // 'c' is not owned
      const countScoped = jest.fn(async (ids: string[]) =>
        ids.filter((id) => owned.has(id)).length,
      );
      const service = makeService();
      const err = await captureThrow(() =>
        service.requireAllOwned(['a', 'b', 'c'], makeOpts(countScoped)),
      );
      expect(err).toBeInstanceOf(CrossTenantNotFoundException);
      expect((err as CrossTenantNotFoundException).getStatus()).toBe(404);
    });

    it('countScoped throws → InternalServerErrorException (500)', async () => {
      const countScoped = jest.fn(async () => {
        throw new Error('db down');
      });
      const service = makeService();
      const err = await captureThrow(() =>
        service.requireAllOwned(['a'], makeOpts(countScoped)),
      );
      expect(err).toBeInstanceOf(InternalServerErrorException);
      expect((err as InternalServerErrorException).getStatus()).toBe(500);
    });
  });
});
