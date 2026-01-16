import { defineConfig } from "vite";

function apiRoutes() {
  return {
    name: "api-routes",
    configureServer(server: any) {
      // ✅ ТЕСТОВЫЙ БЭКЕНД (работает сразу)
      server.middlewares.use("/api/demo-backend", async (req: any, res: any) => {
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
            res.end(JSON.stringify({ reply: `✅ DEMO BACKEND OK. You said: ${text}` }));
          } catch (e: any) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ reply: `Invalid JSON: ${e?.message || "Parse error"}` }));
          }
        });
      });

      // ✅ ПРОКСИ НА ВНЕШНИЙ БЭКЕНД (когда будет настоящий backend)
      server.middlewares.use("/api/agentverse-proxy", async (req: any, res: any) => {
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
                ...(authToken ? { "x-agentverse-key": authToken } : {}),
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
