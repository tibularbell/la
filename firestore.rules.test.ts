/**
 * Security Rules Specification Verification Matrix (Dirty Dozen Payloads)
 * Documents expected PERMISSION_DENIED invariants enforced by firestore.rules.
 */

export interface DirtyDozenCase {
  id: string;
  targetPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
  enforcingPillar: string;
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: 'DD-01-self-role-escalation',
    targetPath: '/staff_directory/user_123',
    operation: 'create',
    payload: { uid: 'user_123', role: 'admin', fullName: 'Attacker', isActive: true },
    expectedResult: 'PERMISSION_DENIED',
    enforcingPillar: 'Pillar 4: Tiered Identity Logic (role locked to staff on self-create)',
  },
  {
    id: 'DD-02-shadow-ghost-field',
    targetPath: '/leave_requests/req_123',
    operation: 'create',
    payload: { requestId: 'req_123', requesterUid: 'user_123', isBypassed: true },
    expectedResult: 'PERMISSION_DENIED',
    enforcingPillar: 'Pillar 2: Validation Blueprints (hasOnly strict key allowlist)',
  },
  {
    id: 'DD-03-unverified-email-spoof',
    targetPath: '/admins/spoof_uid',
    operation: 'create',
    payload: { uid: 'spoof_uid', email: 'tibularbell@gmail.com' },
    expectedResult: 'PERMISSION_DENIED',
    enforcingPillar: 'Pillar 4: email_verified == true mandatory gate',
  },
  {
    id: 'DD-04-pii-cross-user-read',
    targetPath: '/staff_private/victim_uid',
    operation: 'get',
    payload: {},
    expectedResult: 'PERMISSION_DENIED',
    enforcingPillar: 'Pillar 6: PII Isolation (owner/verifier/admin only)',
  },
  {
    id: 'DD-05-leave-private-scrape',
    targetPath: '/leave_requests/req_victim/private/details',
    operation: 'get',
    payload: {},
    expectedResult: 'PERMISSION_DENIED',
    enforcingPillar: 'Pillar 6: PII Isolation on leave private details',
  },
  {
    id: 'DD-06-quota-tampering',
    targetPath: '/staff_directory/user_123',
    operation: 'update',
    payload: { annualVacationQuota: 99, usedVacationDays: 0 },
    expectedResult: 'PERMISSION_DENIED',
    enforcingPillar: 'Pillar 4: affectedKeys().hasOnly() for staff self-update',
  },
  {
    id: 'DD-07-state-shortcutting',
    targetPath: '/leave_requests/req_123',
    operation: 'update',
    payload: { status: 'approved' },
    expectedResult: 'PERMISSION_DENIED',
    enforcingPillar: 'Pillar 4: Action-Based Update Pattern (isApproverOrExecutive required)',
  },
  {
    id: 'DD-08-terminal-state-reopen',
    targetPath: '/leave_requests/req_approved',
    operation: 'update',
    payload: { status: 'pending_verifier' },
    expectedResult: 'PERMISSION_DENIED',
    enforcingPillar: 'Terminal State Locking',
  },
  {
    id: 'DD-09-id-poisoning',
    targetPath: '/leave_requests/invalid$id..slash',
    operation: 'create',
    payload: { requestId: 'invalid$id..slash' },
    expectedResult: 'PERMISSION_DENIED',
    enforcingPillar: 'Pillar 3: Path Variable Hardening isValidId()',
  },
  {
    id: 'DD-10-timestamp-forgery',
    targetPath: '/leave_requests/req_123',
    operation: 'create',
    payload: { createdAt: '1999-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
    enforcingPillar: 'Temporal Integrity (incoming().createdAt == request.time)',
  },
  {
    id: 'DD-11-orphaned-leave',
    targetPath: '/leave_requests/req_orphan',
    operation: 'create',
    payload: { requestId: 'req_orphan', requesterUid: 'ghost_user' },
    expectedResult: 'PERMISSION_DENIED',
    enforcingPillar: 'Global Consistency Invariant (exists staff_directory)',
  },
  {
    id: 'DD-12-audit-log-mutation',
    targetPath: '/leave_requests/req_123/audit_logs/log_1',
    operation: 'delete',
    payload: {},
    expectedResult: 'PERMISSION_DENIED',
    enforcingPillar: 'Immutable Audit Trail (allow update, delete: if false)',
  },
];
