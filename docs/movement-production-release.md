# Movement assessment production release

Released November 4, 2026 to https://app.itrainspeed.com.

Source: feature/movement-assessment-onboarding, b1285efedda5e01320db99045974fe5611184d40. GitHub source-equivalent commit c0f4ba1b1eabb5dfaee704cf04cceff3d9dca3d0. Main was not merged.
Deployment: dpl_D6h5EMeNhP3PXjZhzsgo5xzxX7Br (READY), confirmed on the live domain.
Previous deployment: dpl_E5a14Y6s3gBSFKNaMQouTDKVFQyn.

Applied only 20261104141328_movement_rubric_standing_calendar.sql to production. Seeded the 20-drill Initial Movement Assessment rubric, with no scores or synthetic reports. The staging-only completion fixture was not applied to production.

Verification: 100 local checks and production build passed; 15 staging Auth/API checks passed; staging, candidate and live HTTP/assets/unauthorized-endpoint checks passed. All public tables retain RLS. Existing customer, booking, purchase and credit counts unchanged. All 25 existing public function definitions other than the intentional intro_slots update are unchanged. Both existing five-minute mail schedules remain active. Existing security advisor findings are unchanged; no new finding categories or counts. Existing security-definer view advisory reference: https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view .

Assessments last 45 minutes, cost $0 and deduct no training credits. Coach approval remains the training access gate. Movement reports remain separate from quantitative benchmarks and ongoing progress graphs.

Limitations: signed-in interactive browser walkthrough and actual notification recipient delivery were not tested. Managed staging Auth/API tests verified authorization, scheduling, report visibility, edits and history. No live customer records were created for testing; no production mail-dispatch endpoint was invoked. No purchases or upgrades.

Rollback: retain new reports/revisions and database tables. Reverting the UI alone may not restore compatibility with retired assessment booking/publishing operations; consult docs/movement-assessment-review.md and review compatibility wrappers before reverting. Do not drop data to roll back.
