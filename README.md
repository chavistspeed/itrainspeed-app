# iTrainSpeed Production V1.4.1

Wallet and booking UX patch on top of V1.4.

## What changed
- Dashboard now shows typed Group, Private, and Track access instead of the legacy generic credit count.
- Group and Private credits remain family-shared.
- Track memberships remain athlete-specific.
- Active packages include direct booking actions.
- Booking can be filtered by entitlement type and athlete.
- Booking only shows sessions supported by active access.
- Existing V1.4 database schema and entitlements are preserved.

## Deploy
1. If V1.4 safe upgrade already ran successfully, **do not rerun it**. V1.4.1 has no required database migration.
2. Replace the application files at the GitHub repository root with this build. Do not nest the folder.
3. Commit and allow the existing Vercel project to deploy. Do not change Vercel root directory or environment variables.
4. Test Plans -> Book a Session and Dashboard -> Book Training.

# iTrainSpeed Production V1.4 — Packages & Entitlements

Builds on the verified V1.3 booking platform.

## New in V1.4
- Admin-managed package catalog seeded with current iTrainSpeed pricing
- Typed access: group, private, track, recovery
- Credits, memberships, and promotions
- Founding Athlete promo ($175, first 10 model prepared)
- Off-Season Track & Field membership ($175/month, athlete-specific)
- Admin test grants so entitlement logic can be tested before Stripe
- Booking now consumes the correct entitlement type and cancellation restores typed credits
- Plans tab for parents/admins

## Upgrade
1. Run `supabase/v1-4-safe-upgrade.sql` in Supabase SQL Editor.
2. Replace the GitHub repository root with this build and commit.
3. Let Vercel deploy Production.
4. Open Plans as Admin and grant a Group package to your test account.
5. Book an eligible Speed & Agility session; verify the typed credit decrements.
6. Cancel; verify the typed credit returns.

Do not connect Stripe keys yet. Stripe test-mode checkout is the next phase after this logic passes.
