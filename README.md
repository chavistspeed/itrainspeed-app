# iTrainSpeed Production V1.1

Adds the complete booking lifecycle test features:

- Parent cancellation from Home
- Automatic credit restoration using the existing `cancel_booking` RPC
- Coach session cards open a live athlete roster
- Safe, rerunnable Supabase upgrade in `supabase/v1-1-safe-upgrade.sql`

## Upgrade from Production V1
1. Run `supabase/v1-1-safe-upgrade.sql` in Supabase SQL Editor.
2. Replace the contents of the existing GitHub `itrainspeed-production-v1` folder with this package's contents.
3. Commit to `main`. Vercel will redeploy automatically.
4. Test: Home -> Cancel -> confirm credit restored and coach count decrements; Coach -> session -> roster.

## V1.2 upgrade
Run `supabase/v1-2-safe-upgrade.sql` once in the existing Supabase project. It replaces only the `book_session` RPC so a cancelled athlete/session booking is reactivated instead of inserting a duplicate row. It preserves the existing unique constraint and booking history.


## Production V1.3
Adds in-app Program Management, weekly recurring session publishing, safe coach/admin session cancellation with automatic credit refunds, and booked-state protection on the booking screen. Run `supabase/v1-3-safe-upgrade.sql` once before using program edits or session cancellation.
