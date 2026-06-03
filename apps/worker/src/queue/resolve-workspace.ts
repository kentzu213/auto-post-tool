import { PrismaClient } from '@prisma/client';

/**
 * Outcome of resolving the owning workspace for a publish job.
 *
 * Resolution is derived *purely* from the stored foreign keys
 * (`Schedule.post.workspaceId` and `Schedule.socialAccount.workspaceId`).
 * It NEVER reads any workspace hint from the job payload (Req 10.5).
 */
export type Resolution =
  | { ok: true; workspaceId: string }
  | { ok: false; reason: 'unresolvable' | 'cross_workspace_mismatch' };

/**
 * Resolve the workspace that owns a schedule, using only its stored foreign keys.
 *
 * - DB error, missing schedule, missing `post`/`socialAccount`, or a null
 *   `workspaceId` on either side → `{ ok: false, reason: 'unresolvable' }` (Req 10.4).
 * - `post.workspaceId !== socialAccount.workspaceId`
 *   → `{ ok: false, reason: 'cross_workspace_mismatch' }` (Req 10.3).
 * - Otherwise → `{ ok: true, workspaceId }`.
 *
 * @param prisma A `PrismaClient` (the worker uses `new PrismaClient()`).
 *               Tests may pass an in-memory fake via `as unknown as PrismaClient`.
 * @param scheduleId The id of the schedule to resolve.
 */
export async function resolveOwningWorkspace(
  prisma: PrismaClient,
  scheduleId: string,
): Promise<Resolution> {
  let schedule;
  try {
    schedule = await prisma.schedule.findUnique({
      where: { id: scheduleId },
      include: {
        post: { select: { workspaceId: true } },
        socialAccount: { select: { workspaceId: true } },
      },
    });
  } catch {
    return { ok: false, reason: 'unresolvable' }; // DB failure (Req 10.4)
  }

  if (!schedule) return { ok: false, reason: 'unresolvable' }; // missing schedule (Req 10.4)

  const postWorkspaceId = schedule.post?.workspaceId;
  const accountWorkspaceId = schedule.socialAccount?.workspaceId;

  // missing relation or null FK (Req 10.4)
  if (!postWorkspaceId || !accountWorkspaceId) {
    return { ok: false, reason: 'unresolvable' };
  }

  // foreign-key workspaces disagree (Req 10.3)
  if (postWorkspaceId !== accountWorkspaceId) {
    return { ok: false, reason: 'cross_workspace_mismatch' };
  }

  return { ok: true, workspaceId: postWorkspaceId };
}
