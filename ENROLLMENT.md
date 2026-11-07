# Direct Off-Season Track enrollment

## Production compatibility correction — November 7, 2026

Signed-in Vercel browser inspection confirmed the active production deployment is `dpl_8CJRQ7vvAbFcrYu9ekhtrsc3Fxj6`, sourced from `feature/existing-athlete-onboarding` with CLI commit `f14c3635086019cf06ba24d54b5cbb143e07294c`. That CLI commit is not available through GitHub. The corresponding GitHub source branch is `f226109d36aa372fb1848ab46f948181ab8d9b6a`. The production source viewer confirms TrainingGate and the newer coach approval, onboarding, and assessment components exist; main did not contain these features.

The original enrollment preview based on main must not be released. The corrected preview incorporates the existing-athlete-onboarding source branch, retains all its UI/API/database source and locked dependencies, and checks the existing training_approved RPC before enrollment. No SQL was applied or production data changed. New approval-negative tests ensure unapproved families cannot enter Stripe or be falsely told to repeat an intro call.

Corrected validation: 118 combined tests pass sequentially, including isolated PostgreSQL/PGlite contract and concurrency tests; the production build passes; all 9 mocked browser scenarios pass, including waiver signing and an unapproved returning family. Actual customer login, real Stripe test-mode webhook fulfillment, and an exact full-source comparison with the CLI deployment remain release verification items. The visible hosted preview reached the app's login page with the enrollment destination retained. Vercel connector authorization still fails, but signed-in browser inspection is available.

This correction supersedes the original assumption below that main represented production. The first preview had 14 generated pages; the corrected build retains 18, including the assessment and intro tools. No new database migration is required for the enrollment feature; the included upstream SQL files are already-deployed source history and must not be replayed.

## Scope

The new `/enroll/off-season-track` page resolves exactly one existing `Off-Season Track & Field` membership from the catalog. Pricing and recurrence come from that record; the seeded price is $175. It never substitutes a different plan. Parents log in with a safe return to the program, select an owned athlete, complete the current waiver if needed, and use the existing Stripe checkout and webhook. Active membership detection is scoped to the athlete and package, including memberships with cancellation scheduled for the future. Eligible sessions are booked through the existing booking page and `book_session_v15`.

No new database migration, Stripe product change, intro-call bypass flag, assessment status change, or deployment setting change is included. The production application requires coach approval through training_approved; that gate remains enforced in checkout, booking, and the enrollment page. Approved returning families do not need another intro call or assessment. An unapproved returning family is told to contact the coach, rather than being sent to book a new intro call. Existing profile lookup, athlete ownership checks, waiver signing, server booking checks, notifications, and other plan checkouts remain in place. The existing source collects athlete age and parent name/email; this change does not introduce the separate phone/birthdate registration work discussed in the older chat.

Checkout returns do not grant access. The page polls for the existing webhook's entitlement for up to 60 seconds, then offers manual refresh and support. A success return never offers a second purchase while activation is pending. Existing server checks prevent buying the same active membership. Existing behavior does not serialize simultaneous checkout attempts before either payment has completed; this change does not add a new payment reservation system.

## Validation on November 7, 2026

- Base: repository main commit `6257f44`.
- Production `https://app.itrainspeed.com/plans`: HTTP 200, Vercel, matched path `/plans`.
- Production candidate path `/enroll/off-season-track`: HTTP 404 before release. It is not a live enrollment link.
- Public live Plans JavaScript uses the existing Stripe checkout endpoint and has no direct enrollment route.
- GitHub's Vercel status for the base commit is successful and points to the `itrainspeed/itrainspeed-app` project.
- Authenticated Vercel inspection returned 403 for the itrainspeed team. The team authorization tool returned 404 for both the provided team ID and slug. Thus the production commit, project settings, and live catalog record/price have not been independently confirmed through authenticated access.
- Production build passed.
- Eleven Node tests passed: program identity, expiry/status, athlete separation, safe login return, checkout return paths, server pricing, authentication, athlete ownership, duplicate membership rejection, waiver enforcement, and fail-closed membership lookup.
- Eight isolated browser scenarios passed at mobile width: login return; selection → checkout request → webhook activation → eligible Track booking; existing/cancelling memberships and sibling separation; waiver signing and return; cancelled checkout; no athlete; unavailable program; failed membership lookup.
- Browser external responses and checkout-route dependencies were mocked. No real parent data, charge, booking, or remote database write was used. Real Stripe/webhook/database integration remains a release verification step.

## Reproduce local checks

Use Node 24 for the experimental Node module mocks in the route tests. Install the existing package.json dependencies with the project's normal package manager, then run `npm test` and `npm run build` (or equivalents).

Browser checks use Playwright. Install it separately or set `PLAYWRIGHT_MODULE` to an existing Playwright module. Build with these deliberately fake public settings:

```
NEXT_PUBLIC_SUPABASE_URL=https://enrollment-test.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key
```

Start the production build at `http://127.0.0.1:3100`, then run `node tests/enrollment.browser.mjs`. If using an existing Chrome installation, set `CHROME_EXECUTABLE` to its executable path. The tests intercept the fake Supabase host and payment requests; never point this mocked suite at production. `TEST_BASE_URL` can select a different local port. The production source branch's dependency versions, pnpm lockfile, workspace configuration, and test dependencies are preserved. The corrected build uses Next 15.5.28 and Supabase JS 2.118.0 from that lockfile.

## Approval and release steps

The owner approved publishing branch `codex/off-season-direct-enrollment` and creating previews only. Draft PR #1 is open. No production release or merge has been approved. The first preview was published from main; the correction below aligns it with the source branch already deployed in production.

1. Review the patch and this report. Approve **publishing the branch and creating a preview deployment**. This does not approve merging or production release.
2. Restore Vercel access to the itrainspeed team/project, inspect the actual project root, production branch, deployment commit, domain, and preview payment/database settings. Confirm the current catalog has exactly one correctly named Track membership, price 17500 cents, correct monthly/one-time behavior, and active status. No settings or live records should be changed without approval.
3. Publish the branch, open a draft PR, and obtain the preview build. Use isolated Stripe test mode and test data for real API/webhook verification. Verify an existing parent's login return; athlete selection and sibling isolation; active/expired/scheduled-cancellation memberships; missing waiver/profile lookup failures; successful and cancelled checkout; delayed webhook activation; eligible Track sessions, capacity, booking, notifications, and cancellation. Regression-check regular Plans checkout and dashboard booking. Do not charge a real customer for testing.
4. Review the exact tested commit and approve **merging and deploying that commit to production**. Confirm whether the configured production branch deploys automatically on merge before taking either action.
5. After release, verify the production domain serves the new page, login returns correctly, the live catalog shows the intended $175 program, active membership detection works, and booking eligibility still uses server enforcement. Verify the actual payment webhook configuration without making an unauthorized live charge. Provide the owner the final URL only after these checks pass. Clearly identify any remaining live-payment verification limitation.

Suggested first approval: “Approve publishing the off-season enrollment branch and creating a preview; keep production unchanged.”
Suggested later release approval: “Approve merging and deploying the verified off-season enrollment commit to production.”
