// Vercel serverless function - Create payment intent
// Persists intents to Supabase so they survive across serverless invocations

import crypto from "crypto";
import { logServerError } from "../_telemetry.js";
import { verifyToken } from "../_auth.js";
import { serviceHeaders } from "../_supabase.js";

type SolanaNetwork = "mainnet-beta" | "devnet";
const DEFAULT_USDC_MINTS: Record<SolanaNetwork, string> = {
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

function normalizeNetwork(input?: string): SolanaNetwork {
  return input === "devnet" ? "devnet" : "mainnet-beta";
}

function isValidSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

function resolveUsdcMint(network: SolanaNetwork): string {
  const envDefault =
    network === "devnet" ? process.env.USDC_MINT_DEVNET : process.env.USDC_MINT_MAINNET;
  const candidate = process.env.USDC_MINT || envDefault || DEFAULT_USDC_MINTS[network];
  if (!candidate || !isValidSolanaAddress(candidate)) {
    return DEFAULT_USDC_MINTS[network];
  }
  return candidate;
}

const SOLANA_NETWORK: SolanaNetwork = normalizeNetwork(process.env.SOLANA_NETWORK);
const USDC_MINT = resolveUsdcMint(SOLANA_NETWORK);
const USDC_DECIMALS = 6;

const PLATFORM_WALLET =
  process.env.ECHO_PLATFORM_WALLET || "BRDtaRBzDb9TPoRWha3xD8SCta9U75zDsiupz2rNniaZ";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Require JWT auth
  const user = verifyToken(req.headers?.authorization);
  if (!user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const { agentId, amount, receiver, buyer } = req.body;

    if (!agentId || typeof agentId !== "string") {
      return res.status(400).json({ error: "agentId is required" });
    }

    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ error: "Valid amount is required" });
    }

    if (!buyer || typeof buyer !== "string") {
      return res.status(400).json({ error: "buyer wallet address is required" });
    }

    // Ensure the authenticated wallet matches the buyer
    if (user.sub !== buyer) {
      return res.status(403).json({ error: "Buyer wallet does not match authenticated wallet" });
    }

    const paymentReceiver = receiver && typeof receiver === "string"
      ? receiver
      : PLATFORM_WALLET;

    if (!isValidSolanaAddress(paymentReceiver)) {
      return res.status(400).json({ error: "Invalid receiver wallet address" });
    }

    if (!isValidSolanaAddress(buyer)) {
      return res.status(400).json({ error: "Invalid buyer wallet address" });
    }

    const intentId = crypto.randomBytes(16).toString("hex");
    const now = Date.now();
    const expiresAt = now + 10 * 60 * 1000; // 10 minutes
    const amountRaw = Math.round(amount * 10 ** USDC_DECIMALS);

    // Persist intent to Supabase
    const supa = serviceHeaders();
    if (supa) {
      const intentData = {
        id: intentId,
        agentId,
        amount,
        amountRaw,
        receiver: paymentReceiver,
        buyer,
        createdAt: now,
        expiresAt,
      };
      await fetch(`${supa.url}/rest/v1/app_state`, {
        method: "POST",
        headers: { ...supa.headers, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          owner: "global",
          scope: `payment_intent:${intentId}`,
          data: intentData,
        }),
      });
    }

    return res.status(200).json({
      success: true,
      paymentIntent: {
        id: intentId,
        amount,
        amountRaw,
        receiver: paymentReceiver,
        usdcMint: USDC_MINT,
        expiresAt,
      },
    });

  } catch (error: any) {
    await logServerError("api/payment/create-intent", error, {
      method: req?.method,
      agentId: req?.body?.agentId,
      receiver: req?.body?.receiver,
    });
    return res.status(500).json({
      error: "Failed to create payment intent",
    });
  }
}

export { USDC_MINT, USDC_DECIMALS, PLATFORM_WALLET };
