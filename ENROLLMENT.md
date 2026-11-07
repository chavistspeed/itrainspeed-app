# Direct Off-Season Track enrollment

## Scope

The new `/enroll/off-season-track` page resolves exactly one existing `Off-Season Track & Field` membership from the catalog. Pricing and recurrence come from that record; the seeded price is $175. It never substitutes a different plan. Parents log in with a safe return to the program, select an owned athlete, complete the current waiver if needed, and use the existing Stripe checkout and webhook. Active membership detection is scoped to the athlete and package, including memberships with cancellation scheduled for the future. Eligible sessions are booked through the existing booking page and `book_session_v15`.

No database migration, Stripe product change, intro-call bypass flag, assessment status change, or deployment setting change is included. The current root application has no intro-call or assessment gate in this path. Existing profile lookup, athlete ownership checks, waiver signing, server booking checks, notifications, and other plan checkouts remain in place. The root code currently collects athlete age and parent name/email; this change does not introduce the separate phone/birthdate registration work discussed in the older chat.

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

Start the production build at `http://127.0.0.1:3100`, then run `node tests/enrollment.browser.mjs`. If using an existing Chrome installation, set `CHROME_EXECUTABLE` to its executable path. The tests intercept the fake Supabase host and payment requests; never point this mocked suite at production. `TEST_BASE_URL` can select a different local port. The existing dependency ranges remain unchanged; no package-manager lockfile was added because that could change Vercel's install manager. Local checks resolved Next 15.5.29, React/React DOM 19.3.1, Supabase SSR 0.7.0, Supabase JS 2.119.0, Stripe 18.5.0, Nodemailer 7.0.13.

## Approval and release steps

The feature is on local branch `codex/off-season-direct-enrollment`. It has not been pushed, merged, or deployed. Pushing may automatically create a Vercel preview, so it is intentionally pending deployment approval.

1. Review the patch and this report. Approve **publishing the branch and creating a preview deployment**. This does not approve merging or production release.
2. Restore Vercel access to the itrainspeed team/project, inspect the actual project root, production branch, deployment commit, domain, and preview payment/database settings. Confirm the current catalog has exactly one correctly named Track membership, price 17500 cents, correct monthly/one-time behavior, and active status. No settings or live records should be changed without approval.
3. Publish the branch, open a draft PR, and obtain the preview build. Use isolated Stripe test mode and test data for real API/webhook verification. Verify an existing parent's login return; athlete selection and sibling isolation; active/expired/scheduled-cancellation memberships; missing waiver/profile lookup failures; successful and cancelled checkout; delayed webhook activation; eligible Track sessions, capacity, booking, notifications, and cancellation. Regression-check regular Plans checkout and dashboard booking. Do not charge a real customer for testing.
4. Review the exact tested commit and approve **merging and deploying that commit to production**. Confirm whether the configured production branch deploys automatically on merge before taking either action.
5. After release, verify the production domain serves the new page, login returns correctly, the live catalog shows the intended $175 program, active membership detection works, and booking eligibility still uses server enforcement. Verify the actual payment webhook configuration without making an unauthorized live charge. Provide the owner the final URL only after these checks pass. Clearly identify any remaining live-payment verification limitation.

Suggested first approval: “Approve publishing the off-season enrollment branch and creating a preview; keep production unchanged.”
Suggested later release approval: “Approve merging and deploying the verified off-season enrollment commit to production.”
