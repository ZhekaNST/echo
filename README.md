# Echo — Web3 AI Agent Marketplace

Echo is a Solana-native marketplace where creators publish AI agents and users pay per session in USDC.

## MVP Status

This repo is configured for production MVP:
- Cloud-backed state (Supabase via server API routes)
- Wallet auth and scoped cloud token flow
- Per-session USDC payments (creator + platform split)
- Creator backend endpoints (standard + verified identity modes)
- Cloud chat history, likes, saves, sessions, purchases, and reviews

## Core Architecture

Frontend:
- React + TypeScript + Vite
- Hash routing (`#/...`)
- Phantom wallet integration

Backend (Vercel serverless):
- `/api/wallet-auth` — challenge/verify + short-lived token
- `/api/cloud-state` — secure read/write to `app_state`
- `/api/reviews` — global reviews with anti-spam rules
- `/api/agent-backend` — creator endpoint proxy
- `/api/payment/*` — payment intent + on-chain verification
- `/api/agent-stats` — aggregated likes/sessions counters

Storage model:
- Table: `app_state` (Supabase)
- Key model: `(owner, scope) -> data(jsonb)`
- Main scopes:
  - `global/agents`
  - `<wallet>/liked`
  - `<wallet>/saved`
  - `<wallet>/sessions` (counters)
  - `<wallet>/active_sessions`
  - `<wallet>/purchases`
  - `<wallet>/chat_history`
  - `global/reviews`

## Reviews Anti-Spam (Production Rules)

Implemented server-side in `/api/reviews`:
- One review per wallet per agent
- 30-second cooldown between submissions from same wallet
- Payload normalization and strict validation

## Environment Variables

Copy `.env.example` to `.env.local`.

Required:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- `ECHO_AUTH_SECRET` (server-only, long random)
- `VITE_PLATFORM_WALLET`
- `ECHO_PLATFORM_WALLET`

Optional:
- `SOLANA_RPC_URL`
- `SOLANA_RPC_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `REPLICATE_API_KEY`
- `ANALYTICS_WEBHOOK_URL`
- `TELEMETRY_WEBHOOK_URL`
- `ECHO_AGENT_IDENTITY_SECRET`

## Local Development

```bash
npm install
npm run dev
```

Build check:

```bash
npm run build
```

## Deployment (Vercel)

1. Connect GitHub repo to Vercel
2. Add all env vars in Vercel Project Settings
3. Deploy branch `main`
4. Run smoke checks from checklist

## Legal Routes

- `#/terms`
- `#/privacy`
- `#/refund`

## Security Notes

- No private keys are stored
- Wallet signing is explicit
- Sensitive Supabase key is server-only
- Creator endpoints are validated before publish
- Production publish rejects smoke/test endpoints

## Docs and Launch Ops

- Product docs route: `#/docs`
- Launch checklist: `MVP_LAUNCH_CHECKLIST.md`
