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
