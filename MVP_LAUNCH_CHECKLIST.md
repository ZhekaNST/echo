# Echo MVP Launch Checklist (Production)

## 1) Core Product Smoke Test
- Home rails render correctly (All/Trending/Top/New/Categories).
- Agent page opens without errors.
- Chat starts and sends messages to backend.
- Back navigation restores previous position cleanly.
- No runtime crash on refresh.

## 2) Wallet & Auth
- Phantom connect/disconnect works.
- Trusted reconnect works after page refresh.
- Cloud auth token is issued (wallet challenge + verify).
- Actions blocked without wallet: like/save/review/publish.

## 3) Cloud Data Consistency
Check with 2 tabs/devices:
- Likes sync across clients.
- Saves sync across clients.
- Sessions counters sync across clients.
- Active sessions sync across clients.
- Chat history syncs per wallet.
- Reviews are visible globally.

## 4) Reviews Anti-Spam
- One wallet can submit only one review per agent.
- Cooldown works (30s between submissions).
- Invalid payloads are rejected by API.
- UI shows friendly error for 409/429.

## 5) Creator Flow Quality Gates
Before publish/edit:
- Name, tagline, prompt, description pass moderation rules.
- Endpoint is valid and production-safe (HTTPS, non-test).
- Verified mode has valid verify URL + app key.
- Endpoint test passes.

## 6) Payments & Revenue Split
- One real payment on production domain.
- Verify transfer split:
  - Creator amount
  - Platform fee (20%)
- `/api/payment/verify` confirms valid tx and rejects invalid tx.

## 7) Error Handling / Fallback
- API failures show user-friendly messages.
- Creator publish failures show actionable reason.
- Review submit failures show actionable reason.
- App remains usable after non-critical failures.

## 8) Legal Minimum
Routes must exist and open:
- `#/terms`
- `#/privacy`
- `#/refund`

Content check:
- Non-custodial wallet language is clear.
- Payment finality and refund conditions are clear.
- Contact/support channel is present.

## 9) Security Hygiene
- `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- `ECHO_AUTH_SECRET` is strong and not leaked.
- Platform wallet env vars are set and match expected wallet.
- Optional webhooks do not expose secrets in client.

## 10) Final Go/No-Go
Go only if all checks above pass in production environment.
