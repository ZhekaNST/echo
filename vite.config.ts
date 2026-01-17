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
            const { text, voiceId, modelId } = JSON.parse(body || "{}");
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
                voice_settings: { stability: 0.5, similarity_boost: 0.75 },
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
