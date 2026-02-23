# Echo MVP Launch Checklist

## 1) Product Smoke Test
- Home: rails render, collection cards navigate/filter correctly.
- Agent page: view, like/save/review require wallet.
- Chat: creator example save flow works and appears in View output.
- Payments: USDC payment succeeds and opens session.
- Revenue split: one tx includes creator payout + platform fee.
- Back navigation: returning to previous pages restores scroll position.

## 2) Critical API Checks
- `POST /api/backend-smoke` returns JSON with `reply`.
- `POST /api/wallet-auth` challenge and verify both pass.
- `POST /api/payment/verify` verifies valid signatures and rejects invalid ones.
- `GET/POST /api/cloud-state` works only with valid auth for user scopes.

## 3) Observability
- Set `ANALYTICS_WEBHOOK_URL` (or `TELEMETRY_WEBHOOK_URL`) in Vercel.
- Confirm server errors appear from:
  - `api/agent-backend`
  - `api/cloud-state`
  - `api/wallet-auth`
  - `api/payment/create-intent`
  - `api/payment/verify`
  - `api/analytics-event`
- Open `#/analytics` and verify:
  - recent payments,
  - failed payment verifications,
  - endpoint test failures.

## 4) Security Hygiene
- Rotate Supabase keys if they were ever shared.
- Verify `SUPABASE_SERVICE_ROLE_KEY` is server-only in Vercel.
- Ensure `ECHO_AUTH_SECRET` is set and long/random.
- Ensure `VITE_PLATFORM_WALLET` and `ECHO_PLATFORM_WALLET` match.

## 5) Performance Baseline
- Build succeeds with manual chunk splitting.
- First load tested on mobile and desktop.
- No blocking errors in browser console on landing, explore, agent, chat.

## 6) Launch Ready
- Status page available at `#/status`.
- Support email link works.
- One real payment verified on mainnet in production domain.
