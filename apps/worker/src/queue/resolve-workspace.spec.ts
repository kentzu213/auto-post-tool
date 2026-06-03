import type { PrismaClient } from '@prisma/client';
import fc from 'fast-check';
import { resolveOwningWorkspace, Resolution } from './resolve-workspace';

/**
 * Shape returned by the fake `schedule.findUnique`. Mirrors the `include`
 * the resolver issues: `post.workspaceId` + `socialAccount.workspaceId`.
 * An extra top-level `workspaceId` can be present as a "payload hint" that
 * the resolver MUST ignore.
 */
type FakeSchedule = {
  id: string;
  workspaceId?: unknown; // payload-style hint — must never be read
  post: { workspaceId: string | null } | null;
  socialAccount: { workspaceId: string | null } | null;
} | null;

/**
 * Build an in-memory fake `PrismaClient` whose `schedule.findUnique` either
 * returns the configured value or throws (to simulate a DB error).
 */
function makePrisma(opts: {
  result?: FakeSchedule;
  throws?: boolean;
}): PrismaClient {
  const fake = {
    schedule: {
      findUnique: async () => {
        if (opts.throws) throw new Error('simulated DB error');
        return opts.result ?? null;
      },
    },
  };
  return fake as unknown as PrismaClient;
}

/**
 * Reference model: the outcome computed purely from the fake's FK values.
 * Note the absence of any `jobHint` / payload term — resolution depends only
 * on the stored foreign keys.
 */
function expectedResolution(
  dbError: boolean,
  scheduleExists: boolean,
  post: { workspaceId: string | null } | null,
  socialAccount: { workspaceId: string | null } | null,
): Resolution {
  if (dbError) return { ok: false, reason: 'unresolvable' };
  if (!scheduleExists) return { ok: false, reason: 'unresolvable' };
  const a = post?.workspaceId;
  const b = socialAccount?.workspaceId;
  if (!a || !b) return { ok: false, reason: 'unresolvable' };
  if (a !== b) return { ok: false, reason: 'cross_workspace_mismatch' };
  return { ok: true, workspaceId: a };
}

describe('resolveOwningWorkspace', () => {
  // Feature: workspace-authorization, Property 9: Worker resolves tenancy from stored foreign keys only
  // **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**
  it('resolves tenancy from stored foreign keys only (payload hint never affects outcome)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          dbError: fc.boolean(),
          scheduleExists: fc.boolean(),
          hasPost: fc.boolean(),
          hasAccount: fc.boolean(),
          postWsNull: fc.boolean(),
          accountWsNull: fc.boolean(),
          wsA: fc.uuid(),
          wsB: fc.uuid(),
          sameWorkspace: fc.boolean(),
          // arbitrary payload/job workspace hint — must be ignored entirely
          jobHint: fc.option(fc.oneof(fc.string(), fc.uuid()), { nil: undefined }),
        }),
        async (g) => {
          const accountWs = g.sameWorkspace ? g.wsA : g.wsB;

          const post = g.hasPost
            ? { workspaceId: g.postWsNull ? null : g.wsA }
            : null;
          const socialAccount = g.hasAccount
            ? { workspaceId: g.accountWsNull ? null : accountWs }
            : null;

          const baseSchedule = g.scheduleExists
            ? { id: 'sched-1', post, socialAccount }
            : null;

          // Same FK values, but one fake carries an extra payload-style hint.
          const prismaWithoutHint = makePrisma({
            result: baseSchedule,
            throws: g.dbError,
          });
          const prismaWithHint = makePrisma({
            result: baseSchedule
              ? { ...baseSchedule, workspaceId: g.jobHint }
              : null,
            throws: g.dbError,
          });

          const expected = expectedResolution(
            g.dbError,
            g.scheduleExists,
            post,
            socialAccount,
          );

          const resultWithoutHint = await resolveOwningWorkspace(
            prismaWithoutHint,
            'sched-1',
          );
          const resultWithHint = await resolveOwningWorkspace(
            prismaWithHint,
            'sched-1',
          );

          // Outcome matches the FK-only model ...
          expect(resultWithoutHint).toEqual(expected);
          // ... and is identical whether or not a payload hint is present.
          expect(resultWithHint).toEqual(resultWithoutHint);

          // ok:true IFF schedule exists AND both FK workspaces present AND equal.
          const shouldBeOk =
            !g.dbError &&
            g.scheduleExists &&
            post?.workspaceId != null &&
            socialAccount?.workspaceId != null &&
            post.workspaceId === socialAccount.workspaceId;
          expect(resultWithoutHint.ok).toBe(shouldBeOk);
        },
      ),
      { numRuns: 200 },
    );
  });

  describe('concrete examples', () => {
    it('equal FK workspaces -> ok', async () => {
      const prisma = makePrisma({
        result: {
          id: 's',
          post: { workspaceId: 'ws-1' },
          socialAccount: { workspaceId: 'ws-1' },
        },
      });
      await expect(resolveOwningWorkspace(prisma, 's')).resolves.toEqual({
        ok: true,
        workspaceId: 'ws-1',
      });
    });

    it('unequal FK workspaces -> cross_workspace_mismatch', async () => {
      const prisma = makePrisma({
        result: {
          id: 's',
          post: { workspaceId: 'ws-1' },
          socialAccount: { workspaceId: 'ws-2' },
        },
      });
      await expect(resolveOwningWorkspace(prisma, 's')).resolves.toEqual({
        ok: false,
        reason: 'cross_workspace_mismatch',
      });
    });

    it('missing schedule -> unresolvable', async () => {
      const prisma = makePrisma({ result: null });
      await expect(resolveOwningWorkspace(prisma, 's')).resolves.toEqual({
        ok: false,
        reason: 'unresolvable',
      });
    });

    it('throwing findUnique (DB error) -> unresolvable', async () => {
      const prisma = makePrisma({ throws: true });
      await expect(resolveOwningWorkspace(prisma, 's')).resolves.toEqual({
        ok: false,
        reason: 'unresolvable',
      });
    });
  });
});
