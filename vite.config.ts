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
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
});
