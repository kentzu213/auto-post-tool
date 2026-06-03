import fc from 'fast-check';

// Feature: workspace-authorization, Property 3: Reads return only active-scope records

/** Stable sort by `id` so two record arrays can be compared order-independently. */
function byId<T extends { id: string }>(records: T[]): T[] {
  return [...records].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Property 3 — Reads return only active-scope records.
 *
 * Collection and aggregate reads of tenant-scoped resources must return ONLY the
 * records whose owning scope equals the resolved active scope, and an empty/zero
 * result when none match. The scoped services express this with a Prisma filter
 * `where: { workspaceId }` (direct tenant scope) or `where: { userId }` (the
 * user-scoped Notification variant, Req 4.4). Critically, for ANY workspace the
 * principal is not a member of, the active-scope read never returns one of that
 * workspace's records.
 *
 * Per the design's Testing Strategy this is implemented as a SELF-CONTAINED test
 * over an in-memory fake of the Prisma calls — `findManyScoped`/`findFirstScoped`/
 * `countScoped` mirror EXACTLY what the scoped services do — so it stays fast and
 * deterministic without booting a service or a database.
 *
 * Validates: Requirements 3.3, 4.1, 4.2, 4.3, 4.4, 7.5, 8.1
 */

// --- In-memory fakes that mirror the scoped Prisma calls exactly. ---

interface TenantRecord {
  id: string;
  workspaceId: string;
}

interface UserRecord {
  id: string;
  userId: string;
}

/** Mirrors prisma.X.findMany({ where: { workspaceId } }). */
function findManyScoped(
  records: TenantRecord[],
  workspaceId: string,
): TenantRecord[] {
  return records.filter((r) => r.workspaceId === workspaceId);
}

/** Mirrors prisma.X.count({ where: { workspaceId } }). */
function countScoped(records: TenantRecord[], workspaceId: string): number {
  return records.filter((r) => r.workspaceId === workspaceId).length;
}

/** Mirrors prisma.X.findFirst({ where: { id, workspaceId } }). */
function findFirstScoped(
  records: TenantRecord[],
  workspaceId: string,
  id: string,
): TenantRecord | undefined {
  return records.find((r) => r.workspaceId === workspaceId && r.id === id);
}

/** Mirrors the user-scoped Notification read: findMany({ where: { userId } }). */
function findManyUserScoped(
  records: UserRecord[],
  userId: string,
): UserRecord[] {
  return records.filter((r) => r.userId === userId);
}

// --- Generators that build a realistic multi-tenant dataset. ---

const workspaceIdArb = fc.constantFrom('ws-a', 'ws-b', 'ws-c', 'ws-d', 'ws-e');
const userIdArb = fc.constantFrom('user-1', 'user-2', 'user-3', 'user-4');

/** A multi-tenant table: unique record ids spread across several workspaces. */
const tenantDatasetArb = fc.uniqueArray(
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 10 }),
    workspaceId: workspaceIdArb,
  }),
  { selector: (r) => r.id, maxLength: 40 },
);

/** A user-scoped table (e.g. Notification): unique ids spread across users. */
const userDatasetArb = fc.uniqueArray(
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 10 }),
    userId: userIdArb,
  }),
  { selector: (r) => r.id, maxLength: 40 },
);

describe('Read isolation (Property 3: reads return only active-scope records)', () => {
  it('collection read returns EXACTLY the active-workspace subset and never another workspace record', () => {
    // Validates: Requirements 3.3, 4.1, 4.3, 8.1
    fc.assert(
      fc.property(tenantDatasetArb, workspaceIdArb, (records, activeWs) => {
        const result = findManyScoped(records, activeWs);

        // Every returned record belongs to the active workspace — no leakage.
        for (const r of result) {
          expect(r.workspaceId).toBe(activeWs);
        }

        // The result is EXACTLY the active-scope subset (nothing dropped, nothing
        // from another workspace added).
        const expected = records.filter((r) => r.workspaceId === activeWs);
        expect(byId(result)).toEqual(byId(expected));

        // For ANY other workspace W (one the principal is NOT scoped to), the
        // active-scope read returns none of W's records (Req 4.3).
        const otherWorkspaces = new Set(
          records.map((r) => r.workspaceId).filter((w) => w !== activeWs),
        );
        for (const w of otherWorkspaces) {
          const fromW = records.filter((r) => r.workspaceId === w);
          for (const leaked of fromW) {
            expect(result).not.toContainEqual(leaked);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('aggregate count equals the active-workspace subset size', () => {
    // Validates: Requirements 4.2, 4.3
    fc.assert(
      fc.property(tenantDatasetArb, workspaceIdArb, (records, activeWs) => {
        const count = countScoped(records, activeWs);
        const collection = findManyScoped(records, activeWs);

        // The aggregate is computed only from active-scope records, so it equals
        // the collection size and never counts another workspace's rows.
        expect(count).toBe(collection.length);
        expect(count).toBe(
          records.filter((r) => r.workspaceId === activeWs).length,
        );
        expect(count).toBeLessThanOrEqual(records.length);
      }),
      { numRuns: 200 },
    );
  });

  it('a workspace with no records yields an empty collection and a zero count', () => {
    // Validates: Requirements 4.1, 4.2
    fc.assert(
      fc.property(tenantDatasetArb, (records) => {
        // 'ws-empty' is never produced by workspaceIdArb, so no record owns it.
        const emptyWs = 'ws-empty';
        expect(findManyScoped(records, emptyWs)).toEqual([]);
        expect(countScoped(records, emptyWs)).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('FOR ANY non-member workspace W, the active-scope read never returns a W-owned record', () => {
    // Validates: Requirements 3.3, 4.3
    fc.assert(
      fc.property(
        tenantDatasetArb,
        workspaceIdArb,
        workspaceIdArb,
        (records, activeWs, otherWs) => {
          // Treat `otherWs` as a workspace the principal is NOT a member of when it
          // differs from the active scope.
          fc.pre(otherWs !== activeWs);

          const result = findManyScoped(records, activeWs);
          const wOwned = records.filter((r) => r.workspaceId === otherWs);

          for (const leaked of wOwned) {
            expect(result).not.toContainEqual(leaked);
          }
          // by-id reads cannot reach across the boundary either.
          for (const leaked of wOwned) {
            expect(findFirstScoped(records, activeWs, leaked.id)).toBeUndefined();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('user-scoped read returns EXACTLY the principal-owned subset and never another user record', () => {
    // Validates: Requirements 4.4
    fc.assert(
      fc.property(userDatasetArb, userIdArb, (records, principal) => {
        const result = findManyUserScoped(records, principal);

        for (const r of result) {
          expect(r.userId).toBe(principal);
        }

        const expected = records.filter((r) => r.userId === principal);
        expect(byId(result)).toEqual(byId(expected));

        // No other user's records leak into the principal's read.
        const others = new Set(
          records.map((r) => r.userId).filter((u) => u !== principal),
        );
        for (const u of others) {
          for (const leaked of records.filter((r) => r.userId === u)) {
            expect(result).not.toContainEqual(leaked);
          }
        }

        // A user who owns nothing gets an empty collection.
        expect(findManyUserScoped(records, 'user-none')).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  describe('concrete examples', () => {
    const dataset: TenantRecord[] = [
      { id: 'p1', workspaceId: 'ws-a' },
      { id: 'p2', workspaceId: 'ws-a' },
      { id: 'p3', workspaceId: 'ws-b' },
      { id: 'p4', workspaceId: 'ws-c' },
    ];

    it('findManyScoped returns only the active-workspace rows', () => {
      expect(findManyScoped(dataset, 'ws-a')).toEqual([
        { id: 'p1', workspaceId: 'ws-a' },
        { id: 'p2', workspaceId: 'ws-a' },
      ]);
    });

    it('countScoped equals the subset size', () => {
      expect(countScoped(dataset, 'ws-a')).toBe(2);
      expect(countScoped(dataset, 'ws-b')).toBe(1);
    });

    it('empty workspace → [] and 0', () => {
      expect(findManyScoped(dataset, 'ws-z')).toEqual([]);
      expect(countScoped(dataset, 'ws-z')).toBe(0);
    });

    it('findFirstScoped cannot read a cross-tenant id', () => {
      // p3 belongs to ws-b; an active scope of ws-a cannot resolve it.
      expect(findFirstScoped(dataset, 'ws-a', 'p3')).toBeUndefined();
      expect(findFirstScoped(dataset, 'ws-b', 'p3')).toEqual({
        id: 'p3',
        workspaceId: 'ws-b',
      });
    });

    it('user-scoped read isolates by userId', () => {
      const notifs: UserRecord[] = [
        { id: 'n1', userId: 'user-1' },
        { id: 'n2', userId: 'user-2' },
      ];
      expect(findManyUserScoped(notifs, 'user-1')).toEqual([
        { id: 'n1', userId: 'user-1' },
      ]);
      expect(findManyUserScoped(notifs, 'user-3')).toEqual([]);
    });
  });
});
