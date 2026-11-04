# Intro calendar and family approval review

Base: `chavistspeed/itrainspeed-app`, main commit `6257f44`.
Branch: `codex/intro-calendar-family-approval` (local only).

## Behavior

Parents can schedule free 20-minute intro calls at `/intro`. Slots start every 20 minutes, Monday–Saturday, 9 AM through 3:40 PM America/New_York, ending by 4 PM. The database requires 24 elapsed hours of advance notice. The public booking RPC allows booking within 90 days. Coach date-specific availability must explicitly cover the entire call; there are no initially open slots.

At `/coach/intro`, coaches add date-specific availability/blockouts, cancel their calls, process pending confirmations, and approve pending families. A dedicated coach-only overview RPC supplies family names under the current self-only profile read policy, without widening that policy. The existing Coach Control Center links here and keeps its prior tabs and actions. Availability uses Eastern wall times independently of the device timezone. Windows cannot be removed or blocked across confirmed calls. Parents can cancel their own calls and rebook; cancellation of an intro does not affect training credits.

All profiles present at migration cutover are grandfathered. Profiles created after cutover default to pending, including an existing Acuity customer's newly created app account. A coach must explicitly approve such a family. Approval is separate from booking or completing an intro. The approval table has no authenticated write permission; the coach approval RPC records actor and timestamp. A role-change guard prevents authenticated parents from promoting themselves to staff through permissive legacy profile policies.

Stripe Checkout checks approval before creating a customer or payment session. Table triggers independently enforce approval for new purchases, entitlement grants, and transitions into booked training, including writes from existing definer RPCs and service-role fulfillment. Existing cancellation/refund/credit RPC bodies, Stripe webhooks, billing portal, and training notification routes are unchanged. Existing purchase status maintenance and renewal updates continue. Existing training booking maintenance remains allowed; changing a booked athlete/session/guardian rechecks approval.

## Concurrency

All calendar writers acquire one transaction advisory lock: intro bookings, availability/blockouts, and training session writes. Conflict checks run after lock acquisition. A partial unique coach/slot index independently prevents duplicate active intro slots; all intro calls have database-enforced 20-minute duration and aligned starts. Booked calls cannot be moved in place; cancel and rebook instead.

The supplied schema confirms sessions use `created_by`, with no assigned-coach field. Blank legacy session durations reserve the schema’s default 60 minutes. The existing schema identifies sessions by `created_by`, not by assigned coach. To avoid inferring an assignment that is not recorded, every published training session reserves that time for every intro coach. This is conservative and may reduce available intro slots for multiple-coach businesses. Revisit after a real coach-assignment field is confirmed. Calendar writes explicitly reject transaction isolation other than READ COMMITTED (PostgREST default), ensuring a stale transaction snapshot cannot hide a newly committed conflict. Validate any custom transaction isolation settings before rollout. The real PostgreSQL race tests exercise separate connections and transactions.

## Confirmations

Booking/cancellation commits a durable outbox row per family/coach recipient. The authenticated notification endpoint verifies call ownership (or assigned coach) and claims each email atomically. SMTP uses the existing environment settings. The coach receives mail at their Supabase Auth email, the family at theirs. Imported Acuity calls intentionally enqueue no duplicate confirmations.

The client processes pending confirmations after saving; a disconnected browser may leave pending mail. Before approved rollout, configure a server scheduler to POST `/api/intro/notifications` with `Authorization: Bearer <INTRO_MAIL_CRON_SECRET>` regularly (for example every five minutes). This change intentionally does not configure an external scheduler or production environment. Keep the secret server-only and use a strong random value. No email addresses or message body are accepted from callers.

SMTP has no exactly-once guarantee. An ambiguous send or process crash leaves `state='sending'`. Operators must inspect the provider logs by stable Message-ID `intro-<outbox id>@itrainspeed.com` before marking the job sent or resetting it to pending. Do not automatically reset uncertain jobs: that can duplicate email. The endpoint reports pending/review counts and the UI displays delivery issues without losing the saved call.

## Acuity appointment

CSV found locally: `schedule2026-11-02.csv`. There are 67 source rows and one future appointment: source ID `1799537202`, Fast Lane Intro, November 6, 2026, noon–12:20 PM America/New_York (17:00–17:20 UTC), Chavis Sibert. Customer contacts are in the separate private preparation record, not committed to this repository.

`scripts/prepare-acuity-import.py` reads the CSV offline, validates the appointment, and writes SQL only after real coach/guardian UUIDs are provided:

```sh
python3 scripts/prepare-acuity-import.py /path/to/schedule2026-11-02.csv \
  --coach-id REAL_COACH_UUID --guardian-id REAL_FAMILY_UUID \
  --output /private/path/reviewed-acuity-import.sql
```

This script never connects to a database. Generated SQL takes the same calendar lock, detects a source-ID/details mismatch, checks for an existing import, and inserts through the same conflict and notice validation. It never grants training approval or sends confirmations. Create covering availability first. Recheck Acuity appointment activity and participant mapping before import. The standard 24-hour rule means the prepared November 6 appointment must be imported by November 5 noon Eastern; after that, stop and explicitly review a migration exception rather than weakening normal booking validation. Do not cancel Acuity until an approved import is verified.

## Required rollout prerequisites — no production changes authorized

1. The November 2 schema export has been received and tested. It includes 11 public tables, 15 functions, 12 RLS policies, two enums, constraints, indexes, the session view, and the auth signup trigger. `tests/exported-schema.sql` reconstructs these objects for local testing with auth stubs; it is NOT a production migration. Confirm the production schema has not drifted since the export, and validate any custom bulk-load or trigger-disabling paths are inaccessible to clients.
2. Exported profile/athlete ownership policies, purchase/booking columns, and enum values have been tested. The migration explicitly revokes anonymous access even if deployment default privileges grant it automatically. The export does not capture every server setting, schema/default grant, view option, installed extension, or Supabase-managed auth detail; staging acceptance must confirm those environment-specific settings.
3. Run this additive, single-use migration in isolated staging, then deploy the branch to an approved staging environment with Stripe test keys and a test SMTP destination. Do not rerun older V1.4 migrations: they may overwrite newer RPCs. The new migration intentionally fails on a second application rather than silently re-grandfathering newly registered families.
4. Verify current V1.5 credit selection, waivers, the six-hour cancellation/refund rule, Stripe test purchases/renewals/webhook retries, limited promotions, memberships, existing notification delivery, and actual parent/coach browser flows. No live Stripe payments or production emails were used for local testing.
5. Review grandfathered count at cutover, approve the new-family list behavior, configure the mail scheduler, and map the Acuity participants.
6. Obtain explicit approval before pushing if repository branch pushes trigger deployments, before merging, before production schema changes, before importing the appointment, and before deployment. No credentials, purchases, plan upgrades, push, merge, deployment, production writes, or real emails are part of this local change.

## Local validation

`pnpm install` and `pnpm test` on Node 24. The suite uses module mocking for server routes, PGlite for migration/RLS/RPC contracts reconstructed from the supplied schema, and an embedded PostgreSQL 18 server with the same schema for real simultaneous transactions. The PostgreSQL helper runs outside the Node test worker to isolate its process-exit hooks. PostgreSQL needs local process/shared-memory permissions. The ephemeral server listens only on 127.0.0.1:55439 and stops after testing. Tests contain fictional data and no production connection strings. On pnpm, allow the `@embedded-postgres` platform package's symlink hydration script or use its runtime `autoRehydrateSymlinks` option (already set in the test).

The production build uses `pnpm build` with no production environment. All 15 exported existing function bodies remain unchanged and are exercised by additional compatibility tests. No authenticated browser acceptance test against a hosted staging instance has been performed. Local schema tests do not verify external Stripe, SMTP, Supabase Auth, or hosting configuration. See `docs/schema-compatibility.md` for the results and remaining acceptance checks.

To roll back application code, restore the prior source only after planning how pending new families should be handled. Do not drop approval guards or intro tables as a casual rollback: that would remove access controls or lose appointment history. Keep all data and review any database rollback separately.
