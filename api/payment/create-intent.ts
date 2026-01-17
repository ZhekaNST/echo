// Vercel serverless function - Create payment intent
// This creates a payment intent that will be verified server-side after payment

import crypto from "crypto";

// USDC on Solana Mainnet
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;

// Platform receiver wallet (for agents without creatorWallet)
const PLATFORM_WALLET = "BRDtaRBzDb9TPoRWha3xD8SCta9U75zDsiupz2rNniaZ";

// In-memory store for payment intents (in production, use Redis/KV)
// This is acceptable for MVP but should be replaced with persistent storage
const paymentIntents = new Map<string, {
  id: string;
  agentId: string;
  amount: number;
  amountRaw: number;
  receiver: string;
  buyer: string;
  createdAt: number;
  expiresAt: number;
}>();

// Cleanup expired intents periodically
function cleanupExpiredIntents() {
  const now = Date.now();
  for (const [id, intent] of paymentIntents.entries()) {
    if (intent.expiresAt < now) {
      paymentIntents.delete(id);
    }
  }
}

export default async function handler(req: any, res: any) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { agentId, amount, receiver, buyer } = req.body;

    // Validate inputs
    if (!agentId || typeof agentId !== "string") {
      return res.status(400).json({ error: "agentId is required" });
    }

    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ error: "Valid amount is required" });
    }

    if (!buyer || typeof buyer !== "string") {
      return res.status(400).json({ error: "buyer wallet address is required" });
    }

    // Use provided receiver or fall back to platform wallet
    const paymentReceiver = receiver && typeof receiver === "string" 
      ? receiver 
      : PLATFORM_WALLET;

    // Validate receiver is a valid Solana address (basic check)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(paymentReceiver)) {
      return res.status(400).json({ error: "Invalid receiver wallet address" });
    }

    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(buyer)) {
      return res.status(400).json({ error: "Invalid buyer wallet address" });
    }

    // Cleanup old intents
    cleanupExpiredIntents();

    // Generate unique payment intent ID
    const intentId = crypto.randomBytes(16).toString("hex");
    const now = Date.now();
    const expiresAt = now + 10 * 60 * 1000; // 10 minutes expiry

    // Calculate raw amount (USDC has 6 decimals)
    const amountRaw = Math.round(amount * 10 ** USDC_DECIMALS);

    // Store the intent
    const intent = {
      id: intentId,
      agentId,
      amount,
      amountRaw,
      receiver: paymentReceiver,
      buyer,
      createdAt: now,
      expiresAt,
    };

    paymentIntents.set(intentId, intent);

    // Return payment details
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
    console.error("Create payment intent error:", error);
    return res.status(500).json({ 
      error: "Failed to create payment intent",
      message: error?.message 
    });
  }
}

// Export for use by verify endpoint
export { paymentIntents, USDC_MINT, USDC_DECIMALS, PLATFORM_WALLET };
