# Approved isolated staging setup

The user approved creating or using isolated staging, test payments, and test emails on November 2, 2026, and reconfirmed the November 6 noon–12:20 PM Eastern Acuity intro call. Production remains excluded from this approval. No added spending, plan upgrades, or paid database branching are authorized.

## Current external access

GitHub access was previously confirmed. Vercel and Supabase integrations must be installed and authenticated before account/project/billing eligibility can be inspected. No staging project or deployment has yet been created. No remote branch has been pushed.

## Prepared database bootstrap

`scripts/prepare-staging-baseline.py --output /private/path/staging-baseline.sql` generates a baseline for a NEW, EMPTY Supabase staging project from the reviewed schema export. It excludes the local fixture's roles, auth tables, and JWT helper replacements. It preserves Supabase-managed Auth and includes only application schema plus four fictional test packages with $1 Stripe-test-mode prices. It never opens a network or database connection.

The generated SQL runs in one transaction and refuses a target with any existing public application relation or Auth user. This is an additional safeguard; the operator must still verify the exact target project is isolated staging. Do not run the original `tests/exported-schema.sql` in a hosted project: it contains test Auth stubs.

Three local tests validate clean initialization, preservation of the auth helper, applying the intro migration afterward, and refusal of existing application schemas/users without changing them.

## Setup sequence after connections are available

1. Inspect the Vercel project linked to `chavistspeed/itrainspeed-app`, its production branch, deployment triggers, current plan, and usage. Read configuration without changing production. Inspect Supabase organizations/projects and zero-cost eligibility. Reuse a verified isolated test project where appropriate; otherwise create a new free project only if an unused allowance is confirmed. Do not enable paid branching or create billable compute.
2. Verify the isolated target contains no customer data. Apply the staging baseline only to a new empty project. For an existing staging database, compare its schema and use a reviewed migration path rather than this bootstrap.
3. Create fictional test accounts through Supabase Auth: a coach and a pre-cutover family first. Then apply the intro/approval migration, and create a post-cutover family to test the pending default. Auth-admin creation should confirm test emails directly where appropriate; do not send signup messages to customer addresses. Use actual supported Auth services, not raw fixture user inserts, for hosted acceptance.
4. Configure branch-scoped Vercel Preview values or a separate isolated staging project. Before pushing/deploying, verify ALL database credentials point to staging, Stripe keys are test-mode, webhook signing is from a separate test endpoint, and email is sent only to controlled test destinations. Never reuse inherited production Supabase or live Stripe configuration. Store secrets through provider configuration; do not paste them into chat or commit them.
5. Deploy only the approved branch to isolated staging. Keep the live production branch, domain, variables, database, Stripe webhooks, and Acuity unchanged. Configure staging Auth redirects to the staging URL. Use existing allowances; stop if any action introduces charges.
6. Run signed-in browser checks: new-family intro booking before approval, blocked purchases/training, coach naming/approvals, published training conflicts, blockouts, confirmation/cancellation messages, grandfathered family access, waivers, selected entitlements, sibling credits, athlete-specific memberships, and six-hour cancellation behavior. Run Stripe test-mode purchase, repeat webhook, subscription/refund, and limited-promo checks. Verify a test-only confirmation worker and scheduled retry behavior. No customer accounts or real charges.
7. Report the staging URL, actual configuration/target identities, acceptance results, and remaining issues. Production rollout, production database migration, merging to the production branch, and the real Acuity import/cancellation still require explicit approval.

## Acuity

The November 6 appointment is user-confirmed. Keep it in Acuity during staging. Use fictional participant mappings and a safe future date for staging import tests; never import the real customer's contact data into a test mail destination. Review the actual coach/family IDs only when preparing the approved real migration. The normal 24-hour notice rule means a standard import of the November 6 noon call must occur before November 5 noon Eastern, or a specific migration exception must be reviewed.

## Cost references checked November 2, 2026

- Vercel Preview environments: https://vercel.com/docs/deployments/environments
- Branch-scoped Preview variables: https://vercel.com/docs/environment-variables
- Supabase free projects/limits: https://supabase.com/pricing
- Supabase branching compute billing: https://supabase.com/docs/guides/platform/manage-your-usage/branching

These describe provider capabilities, not the user's confirmed account eligibility. That must be checked after connecting.
