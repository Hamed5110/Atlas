# 2026-07-30 Workspace Hygiene Record

During the API rate-limit and employee-portal duplicate-claim fixes, the following local workspace files were intentionally left untouched because they were unrelated to the requested bug fixes:

- `DIAGNOSIS.md`
- `MODULE_BUILD_QUEUE.md`

This record exists so future debugging or Git history review does not confuse those pre-existing local workspace changes with the committed application fixes.

Related commits made before this record:

- `05fb043 fix(api): split support diagnostics rate limits`
- `a80227f fix(employee-portal): make auth claim sync idempotent`
