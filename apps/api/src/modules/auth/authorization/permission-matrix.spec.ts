import fc from 'fast-check';
import { Role } from '@prisma/client';
import { can, PermissionMatrix, Action } from './permission-matrix';

const ACTIONS = Object.keys(PermissionMatrix) as Action[];
const ROLES: Role[] = ['owner', 'editor', 'approver', 'viewer'];

describe('RBAC PermissionMatrix', () => {
  // Feature: workspace-authorization, Property 7: RBAC permission matrix is enforced
  it('grants access iff role is owner or the matrix lists the role for the action', () => {
    // Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.3, 7.4, 8.3, 8.4, 8.6
    fc.assert(
      fc.property(
        fc.constantFrom<Action>(...ACTIONS),
        fc.constantFrom<Role>(...ROLES),
        (action, role) => {
          const expected =
            role === 'owner' || PermissionMatrix[action].includes(role);
          expect(can(action, role)).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  describe('concrete examples', () => {
    it('owner is allowed every action', () => {
      for (const action of ACTIONS) {
        expect(can(action, 'owner')).toBe(true);
      }
    });

    it('viewer is denied every action', () => {
      for (const action of ACTIONS) {
        expect(can(action, 'viewer')).toBe(false);
      }
    });

    it('editor is allowed content.create but denied approval.review', () => {
      expect(can('content.create', 'editor')).toBe(true);
      expect(can('approval.review', 'editor')).toBe(false);
    });

    it('approver is allowed approval.review but denied content.create', () => {
      expect(can('approval.review', 'approver')).toBe(true);
      expect(can('content.create', 'approver')).toBe(false);
    });
  });
});
