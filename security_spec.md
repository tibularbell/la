# Security Specification & Payload-First TDD (`security_spec.md`)

## 1. Data Invariants
1. **Identity Integrity**: Every user-authored record (`staff_directory`, `staff_private`, `leave_requests`, `audit_logs`, `telegram_notifications`, `system_settings`, `backup_logs`) MUST bind its `uid` / `requesterUid` / `actorUid` / `senderUid` / `updatedByUid` / `createdByUid` to `request.auth.uid` unless created by a verified administrator (`tibularbell@gmail.com` or `admins/{uid}`).
2. **No Self-Assigned Roles**: Users registering their own `staff_directory/{uid}` document MUST be constrained to `role == 'staff'` and cannot modify `role`, `accumulatedVacationDays`, `annualVacationQuota`, or `used*Days` fields.
3. **PII Isolation (Split Collection)**: Contact phone, residential address, email, hire date, age, and `telegramChatId` are strictly isolated in `staff_private/{uid}` and `leave_requests/{requestId}/private/{detailId}` — never stored in `staff_directory` or `leave_requests`.
4. **Parent Existence & Atomic Batching**: `leave_requests/{requestId}` requires an existing `staff_directory/{requesterUid}`. Subcollections (`private`, `audit_logs`) require the parent `leave_requests/{requestId}` via `exists()` or `existsAfter()`.
5. **Terminal State Locking**: Once a `leave_requests` document reaches `approved`, `rejected`, or `cancelled`, non-admin clients cannot mutate it further.
6. **Temporal Integrity & Immutability**: `createdAt` and `updatedAt` MUST match `request.time`; `createdAt`, `requesterUid`, and `requestId` are immutable on update. `audit_logs` and `backup_logs` are strictly append-only (`allow update, delete: if false`).
7. **Volumetric & Regex Guarding**: All document IDs match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), and all strings and arrays (`departments` max 30 items) enforce explicit `.size()` bounds.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Role Escalation**: Creating `staff_directory/{uid}` with `role: "admin"` as a non-admin user -> `PERMISSION_DENIED`.
2. **Shadow Ghost Field Injection**: Creating/updating `leave_requests/{id}` with extra field `isBypassed: true` -> `PERMISSION_DENIED`.
3. **Email Spoofing**: Request with matching admin email where `request.auth.token.email_verified == false` -> `PERMISSION_DENIED`.
4. **PII Cross-User Read**: Regular staff user reading another user's `staff_private/{otherUid}` -> `PERMISSION_DENIED`.
5. **PII Leave Details Scrape**: Regular staff user reading another user's `leave_requests/{id}/private/details` -> `PERMISSION_DENIED`.
6. **Quota Tampering**: Staff user updating their own `staff_directory/{uid}` `usedVacationDays: 0` or `annualVacationQuota: 99` -> `PERMISSION_DENIED`.
7. **State Shortcutting**: Regular staff user updating their own `leave_requests/{id}` from `pending_verifier` directly to `approved` -> `PERMISSION_DENIED`.
8. **Terminal State Re-opening**: Non-admin attempting to update an `approved` or `rejected` `leave_requests/{id}` -> `PERMISSION_DENIED`.
9. **ID Poisoning**: Creating `leave_requests` with a 300-character or special-character document ID `../admin$hack` -> `PERMISSION_DENIED`.
10. **Client Timestamp Forgery**: Creating `leave_requests/{id}` with a backdated `createdAt` not equal to `request.time` -> `PERMISSION_DENIED`.
11. **Orphaned Leave Record**: Creating `leave_requests/{id}` referencing a non-existent `requesterUid` -> `PERMISSION_DENIED`.
12. **Audit Log Tampering**: Attempting to update or delete an entry in `leave_requests/{id}/audit_logs/{logId}` -> `PERMISSION_DENIED`.
