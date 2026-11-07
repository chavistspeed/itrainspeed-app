# Assessment & progress tracking production release — November 4, 2026

User approved deployment in this chat. Application source commit: `9243915eba6f5c840966217e9d6830315bcbbd24`, branch `feature/free-performance-assessments`.

Live site: https://app.itrainspeed.com/assessments
Coach controls: https://app.itrainspeed.com/coach/assessments

Vercel team/project: `itrainspeed` / `itrainspeed-app` (`prj_Xqz3dSwRP88gLMZMdQG8TWiMUaJb`). Production deployment `dpl_E5a14Y6s3gBSFKNaMQouTDKVFQyn` was staged with production settings, verified, then promoted. Previous deployment: `dpl_3mSPu833dgCfyu63y1aSUzfFBSam` (`itrainspeed-oxoif8dab-itrainspeed.vercel.app`). No GitHub main merge occurred. The connector could not resolve the existing team; the already-authenticated, explicitly scoped CLI used for the previous release verified the target and performed deployment.

## Released behavior

Free initial assessment scheduling, eight configurable tests and three templates, coach result entry, separate ongoing training measurements, parent history/personal bests, and a selectable progress graph with dated coaching notes. Initial assessment results stay the baseline; tests introduced later use their first recorded result as a labeled comparison point. No four-week reassessment cycle. Results are available to the parent immediately on save; an already-open parent page refreshes every 15 seconds and on focus. Appointments cost $0 and consume/refund no training credits.

Final integration checks caught and corrected the coach directory’s `athlete_id` field versus the parent table’s `id`. The adapter is covered by a regression test and included in the deployed commit.

## Database and confirmations

Applied only the new assessment schema and assessment scheduler migrations to production Supabase `owseutucvzrxllzxrslp`. Existing intro approval migration, grandfathering and old baseline upgrades were not rerun. All seven new tables have RLS; browser writes pass guarded RPCs. The request ledger and mail outbox intentionally deny direct browser access.

Provisioned a separate server-only assessment dispatch credential in the existing production environment and Vault. A separate five-minute Cron job calls the assessment notification endpoint only while pending mail exists. The existing intro job, secret and application routes remain unchanged. The assessment Cron run succeeded with no pending mail and without sending mail.

No assessment slots, appointments, results or synthetic accounts were created in production. Coaches must publish initial assessment availability; graphs fill as actual measurements are recorded. Synthetic acceptance data remains confined to staging. No real Stripe action, purchase, refund, credit purchase, plan upgrade or paid resource was initiated.

## Verification

- All 72 local automated checks passed on the final source, including real PostgreSQL races, approval/ownership, initial/ongoing results, graph semantics, Stripe fulfillment and booking/cancellation credit regressions.
- Nine managed staging API checks passed: real Auth sign-ins, library/templates, role protections, approval gate, booking/occupancy/privacy, notification relation lookups, initial baseline, immediately readable ongoing results/idempotency, corrections.
- Hosted staging and staged production builds reached READY. Production pages, browser assets and unauthenticated API protections passed before promotion and again on the public domain. Live domain resolved to the expected READY deployment. Assets use production Supabase, include the ongoing tracker/graph, exclude staging references and the assessment dispatch credential.
- All 24 pre-existing public database function hashes remained unchanged. Customer counts/balances before and after: 21 profiles, 17 athletes, 30 sessions, 11 bookings, 2 purchases, 1 entitlement and 1 remaining entitlement credit. No intro call was created by release checks.
- New production data counts: 8 tests, 3 templates, 0 assessment slots/appointments/results/mail. Both intro and assessment schedulers active every five minutes.
- Runtime error scan for this deployment over the final five-minute release window returned zero error records, with no excluded interval. This is a short check, not long-term monitoring.

Automatic approval review rejected the manual authenticated mail-dispatch check because a queue change could cause real coach/customer messages. The check was removed; no indirect/manual dispatch workaround was used. Production email delivery has not been exercised with a real recipient. Scheduler configuration and empty-queue operation were verified through read-only database checks. Signed-in browser/mobile interaction remains a human acceptance check; API tests and static-page checks are not represented as interactive browser testing.

## Existing advisories

Compared production security advisories before and after: the inherited owner-permission session availability view, pre-existing definer-function execution notices and disabled leaked-password protection remain. New RLS-without-policy informational notices concern the deliberately client-inaccessible assessment outbox and training request ledger; no new exposed definer RPC or owner-permission view was introduced. No unrelated access-control hardening or paid upgrade was attempted.

References: https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Rollback and source continuity

If needed, promote the previous recorded production deployment, preserving all assessment history, approval guards and migration records. Review any separate database rollback carefully; do not drop data or remove conflict guards while assessment appointments exist. The assessment scheduler can be paused separately through Cron if operationally necessary, after reviewing queued mail.

The deployed source remains on the local feature branch and in the packaged source snapshot. GitHub main is still older than both the intro-call release and this release. Reconcile that branch before any future deployment from main to avoid replacing the live features with older code.
