# Private assessment reports, spreadsheets, and videos

Prepared November 16, 2026. Not yet released to the live frontend.

Source base: `codex/off-season-direct-enrollment`, commit `6a02eb8879709aaca07287d863cf84a0d176691f`. Main predates the deployed assessment and onboarding work and must not replace that source. Public checks confirmed `/assessments` and `/enroll/off-season-track` exist on the current app. Vercel team access is required to inspect the exact deployed source and stage/promote this release; no production Git ref was moved.

## User flow

- Coach → Results & Videos, or Coach Assessments → Upload assessment results & videos.
- Select an athlete, add date, title, optional individual scores, feedback and training focus.
- Attach Excel `.xlsx`, CSV, PDF and/or MP4, WebM or MOV videos. Maximum 50 MB per file. Prefer MP4 for playback compatibility.
- Save a private draft or publish to the parent. Each successful upload is retained in the draft before the next file begins. Failed uploads leave the draft and remaining files available to retry.
- Parents → Home → Assessment Results & Videos, or Athlete Hub → View assessment results & videos. Select a child to see published reports, spreadsheet previews/downloads and signed video URLs.
- Existing movement reports, scheduling, benchmark charts and training access remain in place. Spreadsheet attachments do not write into the separate numeric benchmark chart or bulk-split a team spreadsheet. Upload only the selected child's information.
- Spreadsheet previews display up to 200 rows, 30 columns and five sheets. Formulas are not evaluated; cached values are displayed. Original files remain downloadable. Signed file URLs expire after one hour; Refresh files renews them after checking authorization. Editing a published report and saving a draft hides it until republished.

## Database

Applied the additive `private_athlete_assessment_reports` migration to production Supabase `owseutucvzrxllzxrslp`. SQL source: `supabase/assessment-reports.sql`. Do not replay it; the table and policies already exist. Added only `athlete_assessments`, its index/policies, and private `assessment-files` bucket/policies. No existing result, appointment, booking, payment, credit or onboarding function was changed. No assessment/customer test record was inserted into production.

Verified after application: reports table is empty, RLS enabled, bucket is private, file-size limit 52,428,800 bytes, and all five new policies exist. Security advisor categories/counts unchanged: 5 RLS/no-policy informational notices, 1 inherited owner-permission view, 4 anonymous definer-function notices, 20 authenticated definer-function notices, and 1 disabled password-protection notice. The new feature introduces no definer function.

## Verification

- Final optimized Next.js production build passes with the existing app routes and both new report routes.
- Four focused checks pass: CSV quoting/line breaks/zeroes, real Excel workbook previews, report rendering/HTML escaping, and actual PostgreSQL-compatible RLS execution in PGlite.
- Permission tests cover coach insert/upload, hidden drafts, published parent reads, other-family denial, parent write denial, anonymous denial, removed attachment denial, and unpublishing.
- Existing regression suite initially reported 120 passing checks and one interrupted embedded-Postgres process in the legacy concurrency file. Rerunning that file alone passed all seven checks, including 20 simultaneous family requests and calendar conflict guards. No unrelated application logic was altered to resolve it.
- Added an isolated mocked browser scenario for coach draft/upload/publish, parent report rendering, phone layout and upload retry. Chrome failed to launch with SIGABRT in the execution environment, so this browser scenario has NOT passed. Actual signed-in uploads, video playback and live browser walkthrough remain release checks.
- Local compiler uses a temporary WASM fallback because the host-signed Node runtime rejects the native SWC library. This does not change application configuration or committed dependencies. ExcelJS is pinned at 4.4.0; pnpm lockfile is updated while retaining existing locked versions.

## Release

1. Restore Vercel connection team access to `itrainspeed` / `team_Rmm88ODfJBzQiNIoUv6PLJmu`.
2. Inspect current production project `itrainspeed-app` / `prj_Xqz3dSwRP88gLMZMdQG8TWiMUaJb`, exact live source, root and existing environment; preserve the current configuration.
3. Stage this tested source with production configuration and verify the upload/report flow, then promote the tested deployment to `app.itrainspeed.com`.
4. Do not merge the older main branch as a shortcut. Do not invoke any mail dispatcher or real payment during verification.

Application rollback can use the previous Vercel deployment. Preserve reports, file objects, new RLS policies and the private bucket during rollback; do not drop customer assessment data.
