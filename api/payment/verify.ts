// Vercel serverless function - Verify payment on Solana
// CRITICAL: This is the security gate - payment verification happens SERVER-SIDE only

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
const PLATFORM_WALLET = process.env.ECHO_PLATFORM_WALLET || "BRDtaRBzDb9TPoRWha3xD8SCta9U75zDsiupz2rNniaZ";

// RPC endpoints for verification
const RPC_ENDPOINTS = [
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  "https://solana-api.projectserum.com",
  "https://rpc.ankr.com/solana",
];

async function getWorkingRpc(): Promise<string> {
  for (const rpc of RPC_ENDPOINTS) {
    try {
      const response = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      });
      if (response.ok) return rpc;
    } catch {
      continue;
    }
  }
  return RPC_ENDPOINTS[0];
}

async function rpcCall(method: string, params: any[]): Promise<any> {
  const rpcUrl = await getWorkingRpc();

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.SOLANA_RPC_API_KEY ? {
        "Authorization": `Bearer ${process.env.SOLANA_RPC_API_KEY}`
      } : {})
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "RPC error");
  return data.result;
}

interface VerificationResult {
  valid: boolean;
  reason?: string;
  signature?: string;
  amount?: number;
  receiver?: string;
  verifiedAt?: number;
}

async function verifyTransactionOnChain(
  signature: string,
  expectedReceiver: string,
  expectedAmount: number,
  expectedPlatformReceiver?: string,
  expectedPlatformAmount?: number,
): Promise<VerificationResult> {
  try {
    const tx = await rpcCall("getTransaction", [
      signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    ]);

    if (!tx) {
      return { valid: false, reason: "Transaction not found. Please wait for confirmation." };
    }
    if (!tx.meta) {
      return { valid: false, reason: "Transaction metadata not available" };
    }
    if (tx.meta.err) {
      return { valid: false, reason: "Transaction failed on-chain" };
    }

    const preBalances = tx.meta.preTokenBalances || [];
    const postBalances = tx.meta.postTokenBalances || [];
    const expectedRaw = Math.round(expectedAmount * 10 ** USDC_DECIMALS);

    function receivedAmountForOwner(owner: string) {
      let received = 0;
      for (const post of postBalances) {
        if (post.mint !== USDC_MINT || post.owner !== owner) continue;
        const postAmount = parseFloat(post.uiTokenAmount?.uiAmountString || "0");
        const pre = preBalances.find(
          (p: any) => p.accountIndex === post.accountIndex && p.mint === USDC_MINT
        );
        const preAmount = pre ? parseFloat(pre.uiTokenAmount?.uiAmountString || "0") : 0;
        const diff = postAmount - preAmount;
        if (diff > 0) received += diff;
      }
      return received;
    }

    const actualAmount = receivedAmountForOwner(expectedReceiver);
    if (actualAmount <= 0) {
      return {
        valid: false,
        reason: `No USDC transfer found to ${expectedReceiver.slice(0, 8)}...`
      };
    }

    // Verify amount (allow small rounding - 0.01 USDC tolerance)
    const actualRaw = Math.round(actualAmount * 10 ** USDC_DECIMALS);
    if (Math.abs(actualRaw - expectedRaw) > 10000) {
      return {
        valid: false,
        reason: `Amount mismatch: expected ${expectedAmount} USDC, received ${actualAmount.toFixed(6)} USDC`,
      };
    }

    // Optional: verify platform fee transfer
    if (expectedPlatformReceiver && typeof expectedPlatformAmount === "number" && expectedPlatformAmount > 0) {
      const platformRawExpected = Math.round(expectedPlatformAmount * 10 ** USDC_DECIMALS);
      const platformActual = receivedAmountForOwner(expectedPlatformReceiver);
      const platformRawActual = Math.round(platformActual * 10 ** USDC_DECIMALS);
      if (Math.abs(platformRawActual - platformRawExpected) > 10000) {
        return {
          valid: false,
          reason: `Platform fee mismatch: expected ${expectedPlatformAmount} USDC, received ${platformActual.toFixed(6)} USDC`,
        };
      }
    }

    return {
      valid: true,
      signature,
      amount: actualAmount,
      receiver: expectedReceiver,
      verifiedAt: Date.now(),
    };

  } catch (error: any) {
    console.error("Verification error:", error);
    return {
      valid: false,
      reason: error?.message || "Failed to verify transaction"
    };
  }
}

// Check if this signature was already verified (idempotency)
async function isAlreadyVerified(signature: string): Promise<boolean> {
  const supa = serviceHeaders();
  if (!supa) return false;
  try {
    const scope = `verified_tx:${signature}`;
    const r = await fetch(
      `${supa.url}/rest/v1/app_state?owner=eq.global&scope=eq.${encodeURIComponent(scope)}&select=owner`,
      { headers: supa.headers }
    );
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

// Record verified transaction for idempotency
async function recordVerification(signature: string, data: Record<string, any>) {
  const supa = serviceHeaders();
  if (!supa) return;
  try {
    await fetch(`${supa.url}/rest/v1/app_state`, {
      method: "POST",
      headers: { ...supa.headers, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        owner: "global",
        scope: `verified_tx:${signature}`,
        data,
      }),
    });
  } catch {
    // Non-critical - verification still succeeded
  }
}

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
    return res.status(401).json({ verified: false, error: "Authentication required" });
  }

  try {
    const { signature, receiver, amount, platformReceiver, platformAmount, buyer, agentId } = req.body;

    if (!signature || typeof signature !== "string") {
      return res.status(400).json({ verified: false, error: "Transaction signature is required" });
    }

    if (!receiver || typeof receiver !== "string") {
      return res.status(400).json({ verified: false, error: "Receiver address is required" });
    }

    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ verified: false, error: "Valid amount is required" });
    }

    // Validate signature format (base58, 87-88 chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(signature)) {
      return res.status(400).json({ verified: false, error: "Invalid transaction signature format" });
    }

    // Idempotency: if already verified, return success without re-checking on-chain
    if (await isAlreadyVerified(signature)) {
      console.log(`[Payment Verify] Already verified: ${signature.slice(0, 16)}...`);
      return res.status(200).json({
        verified: true,
        signature,
        amount,
        receiver,
        agentId,
        alreadyVerified: true,
      });
    }

    console.log(`[Payment Verify] Checking signature: ${signature.slice(0, 16)}...`);
    console.log(`[Payment Verify] Expected: ${amount} USDC to ${receiver.slice(0, 8)}...`);

    const result = await verifyTransactionOnChain(
      signature,
      receiver,
      amount,
      platformReceiver || PLATFORM_WALLET,
      typeof platformAmount === "number" ? platformAmount : 0,
    );

    if (result.valid) {
      console.log(`[Payment Verify] VERIFIED: ${signature.slice(0, 16)}...`);

      // Record for idempotency
      await recordVerification(signature, {
        amount: result.amount,
        receiver: result.receiver,
        agentId,
        buyer: buyer || user.sub,
        verifiedAt: result.verifiedAt,
      });

      return res.status(200).json({
        verified: true,
        signature,
        amount: result.amount,
        receiver: result.receiver,
        agentId,
        verifiedAt: result.verifiedAt,
      });
    } else {
      console.log(`[Payment Verify] REJECTED: ${result.reason}`);
      return res.status(400).json({
        verified: false,
        error: result.reason,
        signature,
      });
    }

  } catch (error: any) {
    await logServerError("api/payment/verify", error, {
      method: req?.method,
      hasSignature: !!req?.body?.signature,
      receiver: req?.body?.receiver,
      agentId: req?.body?.agentId,
    });
    return res.status(500).json({
      verified: false,
      error: "Server error during verification",
    });
  }
}
