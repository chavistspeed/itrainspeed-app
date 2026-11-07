# Compatibility review of the November 2 Supabase export

The user supplied the requested schema metadata. It contains 2,730 definition/grant rows, including 11 public tables, 15 database functions, 12 RLS policies, two enum types, 39 constraints, 23 indexes, one session view, and the auth signup trigger. No customer records were included.

`tests/exported-schema.sql` reconstructs the supplied public objects for isolated tests. The `auth.users` table and JWT helper functions are deliberately small test stubs. They do not recreate Supabase Auth. The test file must never be executed in production.

## Changes required by the actual schema

- Profile RLS allows only self reads. The earlier coach dashboard used a join that could leave family names blank. The dashboard now uses a narrowly scoped staff-only `coach_intro_overview()` function. It exposes own-coach calls/windows and pending parent-family names, without granting broader profile table access. Parent and anonymous access are tested and rejected.
- `sessions.duration_minutes` is nullable with a 60-minute default. Intro conflict checks now treat an explicitly blank legacy duration as 60 minutes, both when booking an intro and when creating/updating a published training session.
- Explicit anonymous function grants can coexist with the PUBLIC grant under deployment defaults. New public RPCs now revoke both explicit and inherited grants before granting only intended roles. Tests install deliberately permissive default grants to verify the gate remains closed.
- The migration leaves all 15 existing exported function bodies unchanged. The cancellation and booking SQL in older repository upgrade files differs from current deployed definitions; no historical upgrade is rerun.

## Existing behavior verified locally

- The real signup trigger creates the profile, which creates a pending approval entry after cutover; existing profiles remain grandfathered.
- Pending families cannot use `book_session`, `book_session_v14`, or `book_session_v15` to bypass approval. Failed bookings roll back earlier credit changes in the same transaction.
- `book_session_v15` still requires the current participation waiver and validates a specific selected entitlement and athlete ownership.
- Family-shared credits work for siblings; athlete-specific unlimited access cannot be used for the wrong athlete. Unlimited booking/cancellation does not create credits.
- Current `cancel_booking_v14` rejects cancellation inside six hours without changing booking status or returning a credit. Early cancellation and coach cancellation retain typed-credit refunds.
- Service-role Stripe checkout fulfillment grants exact credits once and returns the existing purchase on repeated delivery. Pending-family fulfillment is blocked atomically. Customer roles cannot invoke fulfillment functions.
- Existing subscription expiration/cancellation maintenance and partial-refund purchase updates remain allowed.
- Limited promotion fulfillment remains repeat-safe and rejects sold-out purchases.
- Real PostgreSQL tests using the reconstructed schema run 20 independent simultaneous family requests for one intro slot: exactly one succeeds. Booking/blockout and booking/training creation races leave no overlaps. Unsafe transaction isolation is explicitly rejected.
- New confirmations preserve per-recipient claims and handle uncertain SMTP sends without automatic duplicate delivery. Existing training notification source files remain unchanged.

## Remaining staging acceptance

Local database and mocked server-route tests do not exercise real Stripe network calls, real SMTP delivery, signed-in hosted browser flows, managed Auth, scheduled jobs, or hosting configuration. Before any approved production rollout, verify those against an isolated staging environment with test payments and test mail recipients. Confirm the mail scheduler is configured and the actual coach/family UUIDs for the November 6 Acuity appointment are reviewed.

The export does not contain view options, all schema/default privileges, installed extensions, or server transaction settings. The compatibility fixture reproduces the supplied object definitions, table grants, and routine grants, and separately tests hostile default grants. It is not claimed to be a complete byte-for-byte replica of the hosted environment.

No remote branch push, merge, deployment, production database change, real email, Stripe charge, Acuity import/cancellation, credit purchase, or upgrade has been performed.
