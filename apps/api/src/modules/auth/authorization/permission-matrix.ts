import { Role } from '@prisma/client';

/**
 * The set of role-gated mutating actions across tenant-scoped resources.
 */
export type Action =
  | 'content.create'
  | 'content.update'
  | 'content.delete'
  | 'post.publish'
  | 'approval.review'
  | 'social.connect'
  | 'social.disconnect';

/**
 * Maps each action to the roles allowed to perform it (excluding `owner`, which
 * is permitted every action via {@link can}). This is the single source of truth
 * for the RBAC Permission_Matrix (Req 6).
 */
export const PermissionMatrix: Record<Action, Role[]> = {
  'content.create': ['owner', 'editor'], // Req 6.2
  'content.update': ['owner', 'editor'], // Req 6.2
  'content.delete': ['owner', 'editor'], // Req 6.5
  'post.publish': ['owner', 'editor'], // Req 6.6
  'approval.review': ['owner', 'approver'], // Req 6.4, 7.3
  'social.connect': ['owner', 'editor'], // Req 8.3
  'social.disconnect': ['owner', 'editor'], // Req 8.6
};

/**
 * Returns whether `role` is permitted to perform `action`. `owner` is permitted
 * every action (Req 6.1); all other roles are permitted only when the matrix
 * lists them for the action.
 */
export const can = (action: Action, role: Role): boolean =>
  role === 'owner' || PermissionMatrix[action].includes(role);
