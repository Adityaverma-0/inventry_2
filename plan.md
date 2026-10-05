# Plan: Resolve Auth and Business Day Issues

- [ ] Task 1: Fix 'APP_URL must be configured' in the auth workflow.
    - [ ] Investigate why APP_URL is missing in production/Next.js environment.
    - [ ] Modify `lib/server/security.ts` to allow a local fallback or debug the environment loading.
- [ ] Task 2: Fix business day locking in `lib/domain/common.ts`.
    - [ ] Modify `writableDay` to check if day rollover is appropriate.
    - [ ] Implement automatic rollover or warning instead of 409 error.
- [ ] Task 3: Verify the changes.
    - [ ] Test the auth flow with and without the fix.
    - [ ] Test the daily report/sales workflow to ensure business day logic holds.
