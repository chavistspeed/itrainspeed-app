# Production release — November 3, 2026

Live site: https://app.itrainspeed.com/intro
Coach controls: https://app.itrainspeed.com/coach/intro

The user approved the tested intro flow for the real site. Deployed application commit `5b1d0641700545ef306cea0081e578a6599cdaba` directly from the separate feature branch to the existing Vercel project. Production deployment `dpl_3mSPu833dgCfyu63y1aSUzfFBSam` is READY and promoted. Previous deployment: `dpl_5FBCYiqxkph9PbTpCswx2qABkZ2u`. No GitHub main merge occurred.

## Released behavior

- Requested welcome copy and persistent booking confirmation that replaces the available-time picker.
- 20-minute calls, Monday–Saturday, 9 AM–4 PM Eastern, minimum 24-hour notice, coach availability/blockouts and concurrency guards.
- Coach approval for new-family purchases and training bookings, enforced in the server and database. All 21 existing profiles were grandfathered at cutover.
- Initialized 78 Monday–Saturday availability windows over the coming 90 days for the existing Chavis admin account. Coach can remove availability or add blockouts. Published training sessions automatically exclude conflicting intro slots.
- Existing production Stripe, SMTP, owner email, and Supabase configuration preserved. Added a private dispatch token and a Supabase Cron/Vault/pg_net job every five minutes that calls the email dispatcher only when pending mail exists. Ambiguous SMTP sends remain held for operator review.

## Verification

- All 45 local automated tests passed, including real PostgreSQL concurrency, existing booking/cancellation and credit semantics, Stripe fulfillment/idempotency contracts, approval authorization, and confirmation claims.
- All 15 original production database function definitions were compared before and after migration and remain exactly unchanged.
- Cutover counts unchanged: 21 profiles, 17 athletes, 30 sessions, 11 bookings, 2 purchases, 1 entitlement, and 1 remaining entitlement credit.
- Staged production build and public-domain checks passed: updated pages, browser assets use the live database rather than staging, no dispatch secret in assets, authenticated empty-queue dispatcher returns sent/pending/review all zero, unauthenticated notification and checkout requests return 401.
- Scheduler enabled and verified; no pending jobs, no real intro calls created by release checks, no email sent and no Stripe checkout/charge initiated.
- User accepted the signed-in flow on isolated staging. Automated interactive browser verification remains unavailable because local browser use is disabled. Real SMTP delivery and Stripe network purchases were not exercised by the release checks. Vercel masks sensitive configuration; no claim is made of direct SMTP authentication verification.

## Acuity appointment

November 6, noon–12:20 PM Eastern remains confirmed in Acuity. Reserved that time with a production blockout so nobody can take it through the new calendar. The CSV participant email has no matching Supabase Auth account, so the appointment was not imported and no real-family account was created or invited. After that family creates its real app account, map the account and import the prepared appointment in the same transaction that removes its protective blockout. Keep the original appointment unchanged until the import is verified. The normal 24-hour notice rule requires import before November 5 noon Eastern; later import needs a separately reviewed exception.

## Operations and rollback

Coach signs in with their existing production account at /coach/intro to manage availability and approve families. Staging test accounts do not exist in production.

If application rollback is necessary, the prior Vercel deployment is recorded above. Preserve new tables, bookings, approval guards, and history; reverting application code alone does not remove the new-family database restrictions. Do not drop production data to roll back the UI. The scheduled job can be disabled separately with cron.unschedule after reviewing pending mail.

No repository merge, paid resource, plan upgrade, or credit purchase occurred. The source remains on the separate feature branch; a future deployment from unchanged main would replace the released frontend, so reconcile the feature branch before the next main release.

## Existing advisory review

Production advisories were compared before and after the release: five categories, no newly introduced category. The inherited session_availability owner-permission view and disabled leaked-password protection remain unchanged. Details: [view advisory](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Private-table RLS/no-policy and authenticated/anonymous existing definer-function advisories remain review items, rather than a claim of a clean security audit.
