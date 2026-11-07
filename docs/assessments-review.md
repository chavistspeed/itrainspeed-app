> Released November 4, 2026 with user approval. See `assessment-production-release.md` for the actual production status, migrations, final checks and limitations. The review-stage statements below describe the pre-release implementation.

# Initial assessments & ongoing athlete progress — review package

Prepared November 3, 2026. Branch: `feature/free-performance-assessments`.

## Source reconciliation

GitHub main was inspected at `6257f44`. The intro-call release was deployed directly from a local feature branch, so main does not contain the live intro system. This feature starts from local release documentation commit `c92e574` (application release `5b1d064`). The original local project and GitHub main remain unchanged. Do not deploy the old main branch over the live app.

Production Supabase project `owseutucvzrxllzxrslp` was inspected read-only: profiles, athletes, training sessions/bookings, entitlements, performance_results, family approvals, intro windows/calls/outbox, and approval RPCs. No live customer records were copied into tests. Existing legacy `performance_results` remains unchanged; new structured results use their own tables and historical legacy results are not silently mapped to tests or mixed into personal bests.

## Behavior and entry points

- Parent navigation opens `/assessments`: athlete selection, progress, dated training history, personal bests, initial-baseline/latest comparison and percentage improvement. Saved results are immediately readable by the athlete’s parent, without a publish/review stage. Open parent screens refresh every 15 seconds and on focus. `/athletes` remains available for profile creation.
- Coach Control Center links to `/coach/assessments`: configurable test library, reusable assessment templates, appointment publishing/roster, separate initial-assessment and ongoing training result entry, plus correction audit.
- Seeded tests: 10m fly; 30-second and 45-second run distances; standing broad jump; vertical jump; 40-yard dash; baseball 60-yard dash; 5-10-5 shuttle. Seeded templates: Track, Baseball, Speed & Power. Coaches can add tests such as height/weight and new templates without a code change.
- Units: sprint/shuttle seconds, timed-run metres, jumps inches. Each definition has a protocol and higher/lower improvement direction. A new unit or protocol requires a new definition; archive instead of rewriting historical meaning. Use distinct definitions for hand timing versus gates or different jump methods.
- Coaches publish individual athlete slots (1–120 minutes, default 45), choosing Eastern date/time, template and location. Evening slots are supported. Ambiguous/nonexistent DST wall times are rejected. Assessments have no intro-call business-hours restriction or 24-hour rule; those rules remain intact for intro calls.
- Assessments are always $0 / zero credits, constrained in SQL. No Stripe checkout, purchase, training booking or entitlement is created, consumed or refunded.
- Parents book only their own athletes after explicit coach approval or existing-family grandfathering. Staff cannot book an unapproved family around that gate. Parents cancel before the appointment starts; staff can assist later. Cancel/rebook preserves the original appointment. No waitlist is implemented.
- Initial assessment: coaches enter positive finite numeric measurements once the appointment starts. Save one or more tested fields; leave untested fields blank. Results retain test date, definition, units/protocol, notes, actor and provenance. Partial testing is allowed; the appointment becomes completed when results are saved. Additional unsaved template tests can be entered later. Corrections void the original with reason, timestamp and actor, then insert a replacement; parents cannot modify results.
- Ongoing coaching: choose an athlete, date, whichever tests were used, and coaching notes; save results without any assessment appointment, payment, entitlement or credit transaction. Untested fields remain blank. Weekly testing may cover a different subset each time. Parents see saved results immediately. No automatic results-email blast is sent for each training entry.
- Baseline is the earliest valid initial-assessment result per comparable definition and remains the comparison point as weekly results accumulate. A test first introduced during coaching uses its first recorded measurement as the reference, explicitly labeled “First recorded result.” Personal best is minimum time or maximum distance/height. No conversion or comparison across definitions, units or protocols. The latest reading may be below the personal best; both remain visible.
- There is no four-week reassessment requirement, due date, countdown, retest queue or automatic reassessment booking. Testing continues throughout the month at the coach’s discretion. Dates and coaching notes distinguish the initial assessment from training updates.


## Progress graph

Added November 4, 2026. The parent Athlete Hub and coach athlete view display a responsive line graph above history, with a selector for each comparable test definition. Actual testing dates determine horizontal spacing. A dashed reference line marks the initial baseline (or first recorded result for a newly introduced test); baseline, latest and personal best remain visible beside the graph. Timed tests in seconds say “Lower is faster”; distance/height tests say “Higher is better.”

Tap/click a point, focus it and press Enter/Space, or choose a dated entry to read its value, units, testing protocol and coaching notes. The dated selector also keeps overlapping same-day results accessible. Voided measurements are excluded. One result displays one point without inventing a trend. No new database migration, dependency, payment path or production change is needed for this graph.

Graph verification: nine performance/date/graph checks passed, covering irregular intervals, single/flat/same-day readings, mobile tick limits, comparable-series isolation, corrections and fixed initial baselines. Production build passed after integration. The previous 67-check database/booking suite remains the last full regression run; four new graph checks are additional focused coverage. Interactive browser acceptance on hosted staging remains outstanding.

## Database migration and rollout

New migration: `supabase/migrations/20261104034138_free_performance_assessments.sql`.

Prerequisite: current application schema and the already-released `supabase/v1-6-intro-approval.sql`. Do not replay baseline, grandfathering, or existing production scheduler migrations. The new migration is transactional and intentionally one-time; it fails rather than overwriting an existing assessment installation.

It creates seven RLS-protected tables (including a client-inaccessible, idempotent training-entry request ledger), narrow RPCs and calendar/outbox triggers. Browser roles have SELECT only on authorized assessment records; all mutations pass authenticated, database-enforced ownership/staff checks. Private definer functions pin search_path and revoke default execution; exposed wrappers are invoker functions. No API/service secret is added to client code. The mail table is server-only.

The assessment migration remains unapplied and was revised in place for this clarification; it is not a follow-up migration for an already installed assessment system. All original public function bodies are unchanged. One private helper, `intro_private.slot_free`, gains an assessment conflict filter so the intro calendar hides assessment time. Reciprocal triggers protect intro bookings, blockouts and published training sessions, using the released shared advisory lock and READ COMMITTED requirement. With no assigned-coach field in existing training sessions, the conservative calendar reserves published assessment time across all coaches. Cancel unused slots to release that time.

After explicit approval, apply ONLY this migration to isolated staging, deploy this source to that staging environment and complete signed-in acceptance below. Production rollout needs separate explicit approval. No migration or deployment was performed for this feature.

## Confirmation delivery

The new `/api/assessments/notifications` route uses existing SMTP and server-side Supabase settings. Database changes queue confirmations for family and coach on booking/cancellation/completion. Booking, cancellation, slot cancellation and result-entry clients request delivery after successful saves; errors do not undo appointments or results. Records stay visible in the app.

Before production release configure a separate server-only `ASSESSMENT_MAIL_CRON_SECRET` and a scheduler to POST this endpoint every five minutes with its bearer token and `{}` body. Keep the existing intro scheduler/secret unchanged. No assessment scheduler or secret was provisioned by this task. Without that scheduler, jobs left behind by a closed browser need an authenticated retry or server dispatch. SMTP claims are atomic; uncertain sends stay `sending` for operator review, never blindly retried. Inspect provider logs using `assessment-<mail UUID>@itrainspeed.com` before resolving an uncertain claim.

No real email, purchase, refund, account invitation, paid service, upgrade, or credit purchase was triggered.

## Future OVR Connect CSV import

No API, automatic sync, file-column mapping or importer is assumed or implemented. First obtain a real exported sample and verify its format. Reserved fields: `source` (`manual` or `ovr_csv`), `source_record_id` (unique with source), and `source_metadata` JSON. A future coach-only import must preview explicit athlete UUID matches and test/protocol/unit mappings, preserve timing/jump method, retain source-row provenance and use stable duplicate identity. Reject ambiguous names, incompatible units/protocols, nonfinite values and unknown tests; never infer identity from name alone or merge flying and standing starts. A future import path must receive its own authorization and validation tests.

## Verification

- All 67 automated checks and the production build passed after the continuous-tracking revision; see the packaged test/build logs.
- Real PostgreSQL: 20 concurrent intro requests; 20 concurrent free assessment requests yield exactly one appointment/two outbox recipients; assessment-vs-intro and assessment-vs-training publication races leave one calendar winner.
- SQL contract/RLS: actual exported schema fixture, approval and ownership, parent/anon write denial, family privacy, truthfully occupied slots without identities, invalid values/dates, duplicates, corrections, empty/duplicate templates, archive preservation and unchanged credits/purchases/entitlements. New coverage verifies appointment-free coaching entries, immediate parent reads, isolation from other families, idempotent retries, atomic invalid-batch rejection, unchanged outbox counts and preservation of the initial comparison baseline.
- Existing payment/booking regressions run with the new migration: all 15 original public RPC bodies preserved, Stripe fulfillment/idempotency, promotional limits, approval, waiver flow, entitlement scope, consumption and cancellation/refunds.
- Notification transport tests use mocks: authorization, atomic claims, uncertain SMTP handling and stale booking suppression. They do not send real mail.
- Production build passed with Next.js 15.5.28 from the existing lockfile; no dependencies were changed.

Remaining acceptance: signed-in browser/mobile flow on isolated staging, real Supabase PostgREST relation queries and SMTP delivery to test recipients, scheduler recovery after browser closure. These are not claimed as tested. No hosted deployment was made because the user expressly reserved deployment approval.

## Acceptance and rollback

On approved staging: pending family cannot book; approve as coach; create a custom test/template and publish a slot; book with zero credits; confirm both recipients; reject a second family booking; cancel/rebook and verify credits unchanged; record baseline at an elapsed appointment; confirm parent access and other-family isolation; void/correct and preserve audit; save several ongoing training measurements without creating another appointment; verify immediate parent visibility, unchanged initial baseline, latest result and direction-aware personal best. Confirm no reassessment countdown or queue exists. Recheck existing intro booking/approval, training booking/cancellation and Stripe test-mode flow. Do not use real payments for acceptance.

Rollback application changes to the prior live release while preserving assessment data and guards. Do not drop tables or remove calendar guards while assessment appointments exist. Review any database rollback and unsent mail separately. The source archive contains the released intro implementation, which must be retained in any next deployment.
