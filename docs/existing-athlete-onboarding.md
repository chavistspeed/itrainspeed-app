# Existing athlete onboarding recognition

Pending deployment approval. Branch: feature/existing-athlete-onboarding.

In Coach Control Center → Assessments & Athlete Progress, select an athlete. The Existing athlete onboarding panel allows a coach/admin to mark the intro call and Initial Movement Assessment as previously completed. Date and note are optional. Intro completion is family-wide; movement assessment completion is athlete-specific. The coach can undo an acknowledgement; each change retains an append-only history with the recording coach and timestamp.

Parents see completed steps and progress instead of a prompt to repeat onboarding. Family-level completion is true only when all of that family's athletes have completed assessments; sibling status remains independent. No appointments, movement scores, quantitative baselines, charges, credits, waivers or training approvals are fabricated or altered. Waiver signing remains required. Existing scheduled appointments remain intact and must be cancelled separately if no longer needed.

Apply only supabase/migrations/20261104233000_existing_athlete_onboarding.sql to an environment already running the movement release. The migration creates an initially empty, coach-readable audit table and one guarded recording RPC. It changes private onboarding status helpers; all existing public function definitions remain unchanged. Deploy the database migration before the UI, since the coach workspace now reads the history table. Do not replay older migrations. No production changes have been made for this feature.

Verification: 106 automated tests pass sequentially, including actual PostgreSQL scheduling races, privacy, coach permissions, immutable audit, idempotent repeated writes, future-date validation, per-athlete/sibling status and preservation of public payment/waiver/approval functions. Production build passes. The initial concurrent full-suite run hit asynchronous PostgreSQL shutdown errors after all its assertions passed; the sequential full-suite run passed. Signed-in hosted browser testing and staged API verification for this new feature remain pending rollout approval.

Rollback: retain the audit table and history. Revert UI first if needed; restoring original private onboarding helper definitions will stop recognizing prior-completion acknowledgements. Do not delete customer completion history or create fake appointments to roll back.
