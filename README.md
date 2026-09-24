# iTrainSpeed Booking V2
Production-ready foundation for native iTrainSpeed booking.

## Included
- Supabase email/password authentication
- Parent profiles and multiple athletes
- Live programs/sessions
- Atomic credit-based booking + cancellation/refund
- Coach/admin session publishing
- Stripe Checkout Edge Function + webhook foundation
- Performance-results data model
- Mobile-first PWA UI

## 1. Supabase
Create a Supabase project. Open SQL Editor and run `supabase/schema.sql` once.
In Authentication > URL Configuration, add your local and production URLs.

## 2. App environment
Copy `.env.example` to `.env` and add your Supabase Project URL and anon/publishable key.
Never put your Supabase service-role key or Stripe secret key in `.env` exposed to the browser.

## 3. Run locally
`npm install`
`npm run dev`

## 4. Make yourself admin
After creating your own account, run this in Supabase SQL Editor (replace the email):
`update profiles set role='admin' where id=(select id from auth.users where email='YOUR_EMAIL');`

## 5. Stripe
Create a Stripe product/price for the 10-session group package. In Supabase Edge Function secrets add:
- STRIPE_SECRET_KEY
- STRIPE_PRICE_GROUP_10
- STRIPE_WEBHOOK_SECRET
- SUPABASE_SERVICE_ROLE_KEY
Deploy `create-checkout-session` and `stripe-webhook`. Configure Stripe webhook endpoint to the deployed stripe-webhook URL and subscribe to `checkout.session.completed`.

## 6. Deploy
Push this folder to GitHub and import it into Vercel. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel environment variables, then deploy.

## Before accepting real customers
Test signup, booking concurrency, cancellations/refunds, payment success/failure, permissions, email confirmation, age eligibility, waitlist behavior, cancellation window, and Stripe webhook idempotency. Add Terms, Privacy Policy, waiver acceptance, and production monitoring.
