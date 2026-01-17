import { defineConfig } from "vite";

function apiRoutes() {
  return {
    name: "api-routes",
    configureServer(server: any) {
      // ✅ Agent Backend (local development)
      server.middlewares.use("/api/agent-backend", async (req: any, res: any) => {
        if (req.method === "OPTIONS") {
          res.statusCode = 200;
          return res.end();
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ reply: "Method not allowed" }));
        }

        let body = "";
        req.on("data", (c: any) => (body += c));
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body || "{}");
            const lastUser = (parsed?.messages || []).slice().reverse().find((m: any) => m.role === "user");
            const text = lastUser?.content || "(no text)";

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ reply: `✅ Backend OK. You said: ${text}` }));
          } catch (e: any) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ reply: `Invalid JSON: ${e?.message || "Parse error"}` }));
          }
        });
      });

      // ✅ ПРОКСИ НА ВНЕШНИЙ БЭКЕНД (когда будет настоящий backend)
      server.middlewares.use("/api/echo-proxy", async (req: any, res: any) => {
        if (req.method === "OPTIONS") {
          res.statusCode = 200;
          return res.end();
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ reply: "Method not allowed" }));
        }

        let body = "";
        req.on("data", (chunk: any) => (body += chunk));
        req.on("end", async () => {
          try {
            const { targetUrl, authToken, payload } = JSON.parse(body || "{}");
            if (!targetUrl) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify({ reply: "Missing targetUrl" }));
            }

            const upstream = await fetch(targetUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(authToken ? { "x-echo-key": authToken } : {}),
              },
              body: JSON.stringify(payload),
            });

            const raw = await upstream.text();
            const ct = upstream.headers.get("content-type") || "";

            res.statusCode = upstream.status;
            res.setHeader("Content-Type", "application/json");

            if (ct.includes("application/json")) return res.end(raw);
            return res.end(JSON.stringify({ reply: raw.slice(0, 2000) }));
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ reply: e.message }));
          }
        });
      });

      // ✅ Solana RPC Proxy (for production RPC calls without 403)
      server.middlewares.use("/api/solana-rpc", async (req: any, res: any) => {
        if (req.method === "OPTIONS") {
          res.statusCode = 200;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");
          return res.end();
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ error: "Method not allowed" }));
        }

        let body = "";
        req.on("data", (chunk: any) => (body += chunk));
        req.on("end", async () => {
          try {
            const { method, params, id } = JSON.parse(body || "{}");
            if (!method) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify({ error: "Missing method" }));
            }

            // In dev, use public RPC (or env var if set)
            const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
            const rpcApiKey = process.env.SOLANA_RPC_API_KEY;

            const headers: Record<string, string> = {
              "Content-Type": "application/json",
            };

            if (rpcApiKey) {
              if (rpcUrl.includes("helius")) {
                headers["Authorization"] = `Bearer ${rpcApiKey}`;
              } else if (rpcUrl.includes("quicknode")) {
                headers["x-api-key"] = rpcApiKey;
              } else {
                headers["Authorization"] = `Bearer ${rpcApiKey}`;
              }
            }

            const rpcResponse = await fetch(rpcUrl, {
              method: "POST",
              headers,
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: id || 1,
                method,
                params: params || [],
              }),
            });

            const responseData = await rpcResponse.json();

            res.statusCode = rpcResponse.status;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.end(JSON.stringify(responseData));
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "RPC proxy error", message: e.message }));
          }
        });
      });

      // ✅ TTS Proxy (ElevenLabs Text-to-Speech)
      server.middlewares.use("/api/tts", async (req: any, res: any) => {
        if (req.method === "OPTIONS") {
          res.statusCode = 200;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");
          return res.end();
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ error: { message: "Method not allowed", code: "METHOD_NOT_ALLOWED" } }));
        }

        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ error: { message: "TTS service not configured. Set ELEVENLABS_API_KEY in .env.local", code: "SERVICE_NOT_CONFIGURED" } }));
        }

        let body = "";
        req.on("data", (chunk: any) => (body += chunk));
        req.on("end", async () => {
          try {
            const { text, voiceId, modelId, voiceSettings } = JSON.parse(body || "{}");
            const trimmedText = typeof text === "string" ? text.trim() : "";

            if (!trimmedText) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify({ error: { message: "Text is required", code: "TEXT_REQUIRED" } }));
            }

            if (trimmedText.length > 2000) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify({ error: { message: "Text exceeds maximum length of 2000 characters", code: "TEXT_TOO_LONG" } }));
            }

            const finalVoiceId = voiceId || process.env.ELEVENLABS_VOICE_ID;
            if (!finalVoiceId) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify({ error: { message: "Voice ID required. Set ELEVENLABS_VOICE_ID in .env.local", code: "VOICE_ID_REQUIRED" } }));
            }

            // Build voice settings from request or use defaults
            const finalVoiceSettings = {
              stability: voiceSettings?.stability ?? 0.5,
              similarity_boost: voiceSettings?.similarity_boost ?? 0.75,
              style: voiceSettings?.style ?? 0.0,
              use_speaker_boost: voiceSettings?.use_speaker_boost ?? true,
            };

            const finalModelId = modelId || "eleven_multilingual_v2";

            console.log(`[TTS] Request: voice=${finalVoiceId}, model=${finalModelId}, textLength=${trimmedText.length}`);

            const elevenLabsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}`, {
              method: "POST",
              headers: {
                "xi-api-key": apiKey,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
              },
              body: JSON.stringify({
                text: trimmedText,
                model_id: finalModelId,
                voice_settings: finalVoiceSettings,
              }),
            });

            if (!elevenLabsResponse.ok) {
              const errorText = await elevenLabsResponse.text();
              console.error(`[TTS] ElevenLabs error: ${elevenLabsResponse.status} - ${errorText}`);
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify({ error: { message: `TTS service error: ${errorText}`, code: "ELEVENLABS_ERROR" } }));
            }

            const audioBuffer = await elevenLabsResponse.arrayBuffer();
            res.statusCode = 200;
            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Length", audioBuffer.byteLength);
            res.end(Buffer.from(audioBuffer));
          } catch (e: any) {
            console.error("[TTS] Error:", e.message);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: { message: e.message || "Internal error", code: "INTERNAL_ERROR" } }));
          }
        });
      });

      // ✅ Payment Verification (SERVER-SIDE - Critical Security)
      server.middlewares.use("/api/payment/verify", async (req: any, res: any) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.statusCode = 200;
          return res.end();
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ verified: false, error: "Method not allowed" }));
        }

        let body = "";
        req.on("data", (chunk: any) => (body += chunk));
        req.on("end", async () => {
          try {
            const { signature, receiver, amount, buyer, agentId } = JSON.parse(body || "{}");

            if (!signature || !receiver || typeof amount !== "number") {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify({ verified: false, error: "Missing required fields" }));
            }

            console.log(`[Payment Verify] Checking: ${signature.slice(0, 16)}...`);
            console.log(`[Payment Verify] Expected: ${amount} USDC to ${receiver.slice(0, 8)}...`);

            // Use RPC to verify transaction on-chain
            const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
            const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

            const txResponse = await fetch(rpcUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "getTransaction",
                params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }],
              }),
            });

            const txData = await txResponse.json();

            if (txData.error || !txData.result) {
              console.log("[Payment Verify] ❌ Transaction not found");
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify({ verified: false, error: "Transaction not found. Wait for confirmation." }));
            }

            const tx = txData.result;
            if (tx.meta?.err) {
              console.log("[Payment Verify] ❌ Transaction failed on-chain");
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify({ verified: false, error: "Transaction failed on-chain" }));
            }

            // Check token balances for USDC transfer
            const preBalances = tx.meta?.preTokenBalances || [];
            const postBalances = tx.meta?.postTokenBalances || [];
            const DECIMALS = 6;
            const expectedRaw = Math.round(amount * 10 ** DECIMALS);

            let foundTransfer = false;
            let actualAmount = 0;

            for (const post of postBalances) {
              if (post.mint === USDC_MINT && post.owner === receiver) {
                const pre = preBalances.find((p: any) => p.accountIndex === post.accountIndex && p.mint === USDC_MINT);
                const preAmount = pre ? parseFloat(pre.uiTokenAmount?.uiAmountString || "0") : 0;
                const postAmount = parseFloat(post.uiTokenAmount?.uiAmountString || "0");
                const diff = postAmount - preAmount;
                if (diff > 0) {
                  foundTransfer = true;
                  actualAmount = diff;
                  break;
                }
              }
            }

            if (!foundTransfer) {
              console.log("[Payment Verify] ❌ No USDC transfer found to receiver");
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify({ verified: false, error: "No USDC transfer found to receiver" }));
            }

            // Verify amount (allow 0.01 USDC tolerance)
            const actualRaw = Math.round(actualAmount * 10 ** DECIMALS);
            if (Math.abs(actualRaw - expectedRaw) > 10000) {
              console.log(`[Payment Verify] ❌ Amount mismatch: expected ${amount}, got ${actualAmount}`);
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              return res.end(JSON.stringify({ verified: false, error: `Amount mismatch: expected ${amount} USDC` }));
            }

            console.log("[Payment Verify] ✅ VERIFIED");
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ verified: true, signature, amount: actualAmount, receiver, agentId, verifiedAt: Date.now() }));

          } catch (e: any) {
            console.error("[Payment Verify] Error:", e.message);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ verified: false, error: e.message || "Verification error" }));
          }
        });
      });

      // ✅ Payment Intent Creation (for tracking expected payments)
      server.middlewares.use("/api/payment/create-intent", async (req: any, res: any) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.statusCode = 200;
          return res.end();
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ error: "Method not allowed" }));
        }

        let body = "";
        req.on("data", (chunk: any) => (body += chunk));
        req.on("end", () => {
          try {
            const { agentId, amount, receiver, buyer } = JSON.parse(body || "{}");
            const PLATFORM_WALLET = "BRDtaRBzDb9TPoRWha3xD8SCta9U75zDsiupz2rNniaZ";
            const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

            const paymentReceiver = receiver || PLATFORM_WALLET;
            const intentId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const amountRaw = Math.round(amount * 1000000); // 6 decimals

            console.log(`[Payment Intent] Created: ${intentId} for ${amount} USDC`);

            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({
              success: true,
              paymentIntent: {
                id: intentId,
                amount,
                amountRaw,
                receiver: paymentReceiver,
                usdcMint: USDC_MINT,
                expiresAt: Date.now() + 10 * 60 * 1000,
              },
            }));
          } catch (e: any) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [apiRoutes()],
  resolve: {
    alias: {
      buffer: "buffer",
    },
  },
  define: {
    "globalThis.Buffer": "Buffer",
    global: "globalThis",
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
});
