# iTrainSpeed Production V1

Production Next.js foundation for iTrainSpeed booking.

## Deploy to Vercel
1. Replace the old GitHub repository contents with this project's contents (do not upload the zip itself).
2. In Vercel Project Settings > Environment Variables add:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY
3. Redeploy. Vercel should detect Next.js automatically.
4. In Supabase SQL Editor run `supabase/production-migration.sql` once after the earlier Booking V2 schema.
5. Open the deployed app and create your own account.
6. In Supabase SQL Editor run the final commented `update profiles...` statement with your email to promote your account to admin.
7. Sign out/in again. Coach Control Center will be available.

## First end-to-end test
- Admin: create a future session in Coach.
- Parent test account: add an athlete, then book that session.
- Verify the booking count increases in Coach.

## Security
Never commit a Supabase service-role key or Stripe secret key to GitHub. The public anon/publishable key is used client-side with RLS enabled.

## Next milestone
Stripe Checkout + webhook-backed package credits, cancellation window, waitlist, attendance roster, recurring sessions, and performance entry.
