# Initial Movement Assessment — review branch

Status: implemented for review only. No merge, deployment, production migration, credit purchase or plan upgrade is authorized or performed by this update.

Branch: `feature/movement-assessment-onboarding`, based on the released assessment source and its release documentation (`83af5e5`). GitHub main remains older than the released app, so this branch intentionally includes that released source as well as the new changes. The branch-specific `vercel.json` rule disables Git-triggered deployment for this branch; other branches are not changed. See [Vercel's branch deployment configuration](https://vercel.com/docs/project-configuration/git-configuration).

## Confirmed onboarding policy

Account → participation waiver → 20-minute intro call → coach marks intro completed → parent or coach schedules a 45-minute Initial Movement Assessment → coach records movement observations → ongoing performance testing during training.

The user explicitly confirmed that **coach approval remains the training-access gate**. Movement completion does not automatically approve training, and is not an additional gate on Stripe or training purchases/bookings. Existing approved/grandfathered access is retained. Assessment booking instead checks the actual guardian's signed current waiver and an explicitly completed intro call; staff cannot bypass those two requirements on behalf of a family.

Existing calls are not retrospectively marked completed merely because time has passed. A coach must mark an ended booked call completed. The status transition records the actor and timestamp. Parents cannot mark calls completed. Completed, cancelled and no-show states are final; rescheduling a movement appointment creates a replacement appointment and retains the cancelled original.

## Movement rubric

The original rubric was recovered from the referenced **Create An App** chat. Its 20 entries are seeded as an unscored, editable template:

- Dynamic Warm-Up: Jump Rope (2 min); High Knees, Butt Kicks, A-Skips and Lateral Shuffles (30 sec each); Arm Swings / Hip Circles.
- Sprint Mechanics & Acceleration: Wall Drill (2 × 10 reps).
- Agility & Change of Direction: Zig-Zag Cone Drill (2 reps).
- Body Movement: Ladder Overall; Load Leg (first entry); Shuffle; Fast Feet; Fast Knees; Sprint Skips; 1 Leg Bounds; Load Leg (second entry); Shuffles; Endurance; Mental Confidence; Coordination.

Both Load Leg entries and both shuffle entries are retained independently rather than guessing whether they represent different sides or protocols. Coaches can rename or remove them in a new template version. Example athlete scores from the prior chat are **not** copied into actual results.

Scores accept only 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5 or 5. Untested drills remain unscored, not zero. Anchors: 1 needs significant development; 2 developing/frequent corrections; 3 competent/occasional corrections; 4 proficient/consistent; 5 advanced/excellent execution. Every drill has notes. Each report also has dated overall observations, strengths and development priorities. At least one drill must be scored to save a report.

Reports are stored separately in `movement_reports` with rubric snapshots. Every edit adds a full version in `movement_report_revisions`; optimistic revision checks reject stale concurrent edits. Editing a rubric creates a new version and archives the prior one without changing booked/completed report meaning. Saving a report does not silently complete an appointment; completion is an explicit coach action after the appointment ends. Parents see saved reports immediately, with an open Hub refreshing every 15 seconds and on focus.

## Performance benchmarks

Quantitative measurements remain in the released `assessment_tests`, `assessment_templates` and `assessment_results` system. Initial test display names are 10m Fly, 30-second Run, 45-second Run, Broad Jump, Vertical Jump, 40-yard Dash, 60-yard Dash and 5-10-5 Shuttle. Existing IDs, units, protocols and historical snapshots are preserved. Default performance template names are cleaned up to Track Benchmarks, Baseball Benchmarks and Speed & Power Benchmarks.

Coaches add tests/templates and record dated measurements without a movement appointment. The first valid quantitative result is that test's baseline. Personal bests follow the test's higher/lower direction; incompatible units/protocols never share a graph. Movement quality scores never enter a performance graph or personal-best calculation. Existing quantitative history, including any earlier performance appointment records, is retained.

New performance appointments through the former publish/book RPC actions are retired. Existing legacy quantitative result/cancellation paths remain guarded and available for historical records. The new Hub identifies any old performance appointments separately instead of reclassifying them as movement assessments.

## Scheduling and coach controls

- Standing Monday–Saturday, 9 AM–4 PM America/New_York schedule, calculated on request over a rolling 90-day horizon. No availability seeding or recurring publication is required.
- Intro calls remain 20 minutes, on 20-minute boundaries, with at least 24 elapsed hours' notice. A signed waiver is required before slots are offered or booking succeeds.
- Movement assessments are exactly 45 minutes, on 15-minute start boundaries, ending by 4 PM. No extra 24-hour requirement is imposed on assessments.
- Calendar calculations exclude published training, booked intro calls, uncancelled assessment slots and coach-blocked time. Existing training lacks a reliable assigned-coach field, so the conservative shared calendar reserves these times across coaches, as the released implementation already did.
- All calendar writers share the existing transaction advisory lock under READ COMMITTED. Availability is rechecked after locking; selecting a displayed time never guarantees a stale slot can be booked.
- Coaches can schedule for a selected athlete, reschedule an upcoming booked movement appointment, mark it completed/cancelled/no-show, enter/edit reports, manage rubrics and benchmarks, and block a day, part-day or a multi-day vacation (up to 31 elapsed days per block).
- Reschedule is atomic: a failed new reservation leaves the original booked. Overlap with the appointment being moved is available to the authorized coach; other reservations remain protected. Original and replacement links, cancellation and booking notifications are retained.
- Parents can schedule and cancel their own upcoming assessments. Rescheduling is a coach control. Cancelled movement slots release time. Blocks cannot silently displace booked calls or assessments; reschedule/cancel those first.

## Parent wording and notifications

Main labels: Schedule Assessment, Athlete Assessment, Athlete Progress, Performance Benchmarks. No repeated “Free Assessment” headings or price badges. One subdued calendar caption identifies the business time zone; calculations always use Eastern independently of device location.

Existing intro and assessment notification transports, per-recipient claims, outboxes and schedulers are retained. Intro completion/no-show does not try to insert an unsupported mail kind. Rescheduling queues cancellation for the old appointment and confirmation for its replacement. A completion email says the appointment is completed without falsely promising results have already been entered. Ambiguous SMTP sends still remain held for operator review. No real message or payment is sent by local tests.

## Migration and safeguards

Pending migration: `supabase/migrations/20261104141328_movement_rubric_standing_calendar.sql`.

Prerequisites: current application schema plus the already released intro/assessment migrations. Apply **only this new migration** to an approved test database first, then review hosted/signed-in behavior. No database outside temporary local test instances was modified for this task. Production was inspected read-only; at inspection it had the released assessment schema, no movement tables and no assessment records.

The migration is transactional, adds RLS-protected rubric/report/revision tables and completion/audit columns, and preserves the bodies of existing Stripe, credit, waiver-signing, training-approval and training/cancellation RPCs. Explicit ACLs defeat permissive default grants. New exposed RPCs are invoker wrappers over narrowly authorized private functions. Browser roles have SELECT only on authorized reports and revisions; parent writes and anonymous calls are denied. The released legacy manager is no longer directly executable by clients; its private facade retires new performance appointments and prevents numeric result entry against movement appointments.

Do not rerun historical baseline/grandfathering/scheduler migrations, and do not blindly run a blanket database push: historical repository timestamps differ from the migration versions actually recorded by earlier releases. Production application rollout and this compatibility-changing migration must be coordinated after approval. Rolling back only the UI is insufficient because the old assessment booking actions are retired by this migration; review compatibility wrappers separately and retain all report/revision data.

No account, payment, credit balance, notification secret, scheduler, live deployment setting or production data was changed. GitHub branch publication uses the branch-local deployment exclusion, not a server-side production configuration change.

## Verification and remaining acceptance

Local tests cover the actual exported schema and complete migration chain, anonymous/parent/staff authorization, waiver and explicit intro completion, half-point constraints, repeated drills, independent movement/benchmark data, report revision snapshots, stale-edit rejection, archived template preservation, zero billing writes and unchanged training access. Real PostgreSQL races cover competing movement bookings, intro calls, training, blockouts, reschedules and report edits. Server-rendered tests compile actual application components with the pinned Next/SWC compiler and check saved half-points, unscored drills, coaching fields and separated benchmark graphs. Existing Stripe/booking/credit/intro regression tests also run.

All 100 automated checks and the production build passed. See the packaged test and build logs. Remaining before a future approved production release: hosted PostgREST/schema-cache acceptance, signed-in mobile/browser interaction, and notification delivery with approved test recipients. Those checks are not represented as already completed, and no hosted preview was deployed for this update.
