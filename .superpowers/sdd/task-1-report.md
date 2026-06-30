# Task 1 Report: Fix `getGoogleConnections` to source from `account` (LEFT JOIN)

## Status
**DONE**

## Summary
Fixed the core bug where freshly signed-in Google accounts were invisible to calendar sync by changing `getGoogleConnections` from INNER JOIN to LEFT JOIN on `google_connections` table, with role defaulting to "personal" when no connection row exists.

## Test Evidence

### Before (FAIL)
```
bun test v1.3.14 (0d9b296a)

server/auth/google-credentials.test.ts:
36 |     expect(conns.length).toBe(2);
                            ^
error: expect(received).toBe(expected)

Expected: 2
Received: 1

      at <anonymous> (/Users/jiajingteoh/Documents/personal-context/server/auth/google-credentials.test.ts:36:24)
(fail) getGoogleConnections includes google accounts with no connection row, defaulting role to personal [28.20ms]

 1 pass
 1 fail
 6 expect() calls
Ran 2 tests across 1 file. [132.00ms]
```

The INNER JOIN dropped accounts without a `google_connections` row, so only `acc1` was returned instead of both `acc1` and `acc2`.

### After (PASS)
```
bun test v1.3.14 (0d9b296a)

 2 pass
 0 fail
 10 expect() calls
Ran 2 tests across 1 file. [119.00ms]
```

Both tests pass:
1. Existing test: `getGoogleConnections returns tokens, role, and calendar id per google account` (account with role set)
2. New test: `getGoogleConnections includes google accounts with no connection row, defaulting role to personal` (account without role)

## Typecheck Result
```
$ nuxt typecheck
ℹ Nuxt Icon server bundle mode is set to local
```
Exit code 0, no type errors.

## Changes Made

### File: `server/auth/google-credentials.ts`
- Changed `.innerJoin()` to `.leftJoin()` on line 24
- Added null coalescing for role: `r.role ?? "personal"` on line 29

### File: `server/auth/google-credentials.test.ts`
- Added new test case verifying that accounts without a `google_connections` row:
  - Are included in the results
  - Have role defaulting to "personal"
  - Have braindumpCalendarId defaulting to null
  - Accounts with role rows still report their correct role

## Commit Hash
`f7d3b89`

## Concerns
None. The change is minimal and focused, tests pass, types check, and the implementation follows the exact spec provided.
