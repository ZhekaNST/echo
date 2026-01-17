// Vercel serverless function - Verify payment on Solana mainnet
// CRITICAL: This is the security gate - payment verification happens SERVER-SIDE only

// Import payment intent store (Note: in production, use shared KV storage)
// For serverless, we need a different approach - verify directly on-chain

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;
const PLATFORM_WALLET = "BRDtaRBzDb9TPoRWha3xD8SCta9U75zDsiupz2rNniaZ";

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
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getHealth",
        }),
      });
      if (response.ok) {
        return rpc;
      }
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
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error.message || "RPC error");
  }
  
  return data.result;
}

interface VerificationResult {
  valid: boolean;
  reason?: string;
  signature?: string;
  amount?: number;
  receiver?: string;
  agentId?: string;
  verifiedAt?: number;
}

async function verifyTransactionOnChain(
  signature: string,
  expectedReceiver: string,
  expectedAmount: number,
  expectedBuyer?: string
): Promise<VerificationResult> {
  try {
    // Get transaction with full details
    const tx = await rpcCall("getTransaction", [
      signature,
      {
        encoding: "jsonParsed",
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      },
    ]);

    if (!tx) {
      return { valid: false, reason: "Transaction not found. Please wait for confirmation." };
    }

    if (!tx.meta) {
      return { valid: false, reason: "Transaction metadata not available" };
    }

    if (tx.meta.err) {
      return { valid: false, reason: `Transaction failed on-chain: ${JSON.stringify(tx.meta.err)}` };
    }

    // Check token balances
    const preBalances = tx.meta.preTokenBalances || [];
    const postBalances = tx.meta.postTokenBalances || [];

    // Expected raw amount
    const expectedRaw = Math.round(expectedAmount * 10 ** USDC_DECIMALS);

    // Find the USDC transfer to the expected receiver
    let foundValidTransfer = false;
    let actualAmount = 0;

    for (const post of postBalances) {
      // Check if this is USDC going to the receiver
      if (post.mint === USDC_MINT && post.owner === expectedReceiver) {
        // Find pre-balance for same account
        const pre = preBalances.find(
          (p: any) => p.accountIndex === post.accountIndex && p.mint === USDC_MINT
        );

        const preAmount = pre 
          ? parseFloat(pre.uiTokenAmount?.uiAmountString || "0") 
          : 0;
        const postAmount = parseFloat(post.uiTokenAmount?.uiAmountString || "0");
        const diff = postAmount - preAmount;

        if (diff > 0) {
          actualAmount = diff;
          foundValidTransfer = true;
          break;
        }
      }
    }

    if (!foundValidTransfer) {
      // Also check if receiver's ATA received tokens (different check method)
      // This handles the case where the token account was just created
      for (const post of postBalances) {
        if (post.mint === USDC_MINT) {
          const postAmount = parseFloat(post.uiTokenAmount?.uiAmountString || "0");
          const pre = preBalances.find(
            (p: any) => p.accountIndex === post.accountIndex && p.mint === USDC_MINT
          );
          const preAmount = pre 
            ? parseFloat(pre.uiTokenAmount?.uiAmountString || "0") 
            : 0;
          
          if (postAmount > preAmount && post.owner === expectedReceiver) {
            actualAmount = postAmount - preAmount;
            foundValidTransfer = true;
            break;
          }
        }
      }
    }

    if (!foundValidTransfer) {
      return { 
        valid: false, 
        reason: `No USDC transfer found to ${expectedReceiver.slice(0, 8)}...` 
      };
    }

    // Verify amount (allow small rounding - 0.01 USDC tolerance)
    const actualRaw = Math.round(actualAmount * 10 ** USDC_DECIMALS);
    const amountDiff = Math.abs(actualRaw - expectedRaw);
    
    if (amountDiff > 10000) { // 0.01 USDC tolerance
      return {
        valid: false,
        reason: `Amount mismatch: expected ${expectedAmount} USDC, received ${actualAmount.toFixed(6)} USDC`,
      };
    }

    // Optional: verify sender if provided
    if (expectedBuyer) {
      // Check that the transaction was initiated by the expected buyer
      const accountKeys = tx.transaction?.message?.accountKeys || [];
      const feePayer = accountKeys[0]?.pubkey || accountKeys[0];
      
      if (feePayer && feePayer !== expectedBuyer) {
        // This is just a warning, not a rejection (user might use different signing account)
        console.log(`Note: Fee payer ${feePayer} differs from expected buyer ${expectedBuyer}`);
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
    const { signature, receiver, amount, buyer, agentId } = req.body;

    // Validate inputs
    if (!signature || typeof signature !== "string") {
      return res.status(400).json({ 
        verified: false, 
        error: "Transaction signature is required" 
      });
    }

    if (!receiver || typeof receiver !== "string") {
      return res.status(400).json({ 
        verified: false, 
        error: "Receiver address is required" 
      });
    }

    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ 
        verified: false, 
        error: "Valid amount is required" 
      });
    }

    // Validate signature format (base58, 87-88 chars)
    if (!/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(signature)) {
      return res.status(400).json({ 
        verified: false, 
        error: "Invalid transaction signature format" 
      });
    }

    // Log verification attempt (without sensitive data)
    console.log(`[Payment Verify] Checking signature: ${signature.slice(0, 16)}...`);
    console.log(`[Payment Verify] Expected: ${amount} USDC to ${receiver.slice(0, 8)}...`);

    // Perform on-chain verification
    const result = await verifyTransactionOnChain(
      signature,
      receiver,
      amount,
      buyer
    );

    if (result.valid) {
      console.log(`[Payment Verify] ✅ VERIFIED: ${signature.slice(0, 16)}...`);
      
      return res.status(200).json({
        verified: true,
        signature,
        amount: result.amount,
        receiver: result.receiver,
        agentId,
        verifiedAt: result.verifiedAt,
      });
    } else {
      console.log(`[Payment Verify] ❌ REJECTED: ${result.reason}`);
      
      return res.status(400).json({
        verified: false,
        error: result.reason,
        signature,
      });
    }

  } catch (error: any) {
    console.error("[Payment Verify] Server error:", error);
    return res.status(500).json({ 
      verified: false,
      error: "Server error during verification",
      message: error?.message 
    });
  }
}
