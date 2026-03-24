import crypto from "node:crypto";
import { logServerError } from "./_telemetry.js";

type Scope = "agents" | "liked" | "saved" | "purchases" | "reviews" | "sessions" | "active_sessions" | "chat_history";

const TABLE = "app_state";

function b64urlDecode(s: string) {
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function getAuthSecret() {
  return process.env.ECHO_AUTH_SECRET || process.env.ECHO_AGENT_IDENTITY_SECRET || null;
}

function verifyToken(authHeader?: string) {
  const secret = getAuthSecret();
  if (!secret) return null;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signature] = parts;
  const input = `${headerB64}.${payloadB64}`;
  const expected = crypto.createHmac("sha256", secret).update(input).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  if (expected !== signature) return null;

  try {
    const payload = JSON.parse(b64urlDecode(payloadB64));
    if (!payload?.sub || !payload?.exp) return null;
    if (Date.now() >= Number(payload.exp) * 1000) return null;
    return payload as { sub: string; exp: number };
  } catch {
    return null;
  }
}

function serviceHeaders() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return {
    url,
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");

  if (req.method === "OPTIONS") return res.status(200).end();

  const supa = serviceHeaders();
  if (!supa) {
    return res.status(500).json({ error: "Supabase service configuration missing" });
  }
  if (!getAuthSecret()) {
    return res.status(500).json({ error: "Auth secret is missing" });
  }

  const auth = verifyToken(req.headers?.authorization || req.headers?.Authorization);

  try {
    if (req.method === "GET") {
      const owner = String(req.query?.owner || "").trim();
      const scope = String(req.query?.scope || "").trim() as Scope;
      if (!owner || !scope) return res.status(400).json({ error: "owner and scope are required" });

      const isGlobalRead = owner === "global" && (scope === "agents" || scope === "reviews");
      if (!isGlobalRead) {
        if (!auth) return res.status(401).json({ error: "Unauthorized" });
        if (auth.sub !== owner) return res.status(403).json({ error: "Forbidden" });
      }

      const url = `${supa.url}/rest/v1/${TABLE}?owner=eq.${encodeURIComponent(owner)}&scope=eq.${encodeURIComponent(scope)}&select=data&limit=1`;
      const up = await fetch(url, { method: "GET", headers: supa.headers });
      const text = await up.text();
      if (!up.ok) return res.status(up.status).send(text);

      let rows: Array<{ data: unknown }> = [];
      try {
        rows = JSON.parse(text || "[]");
      } catch {
        rows = [];
      }
      return res.status(200).json({ data: rows?.[0]?.data ?? null });
    }

    if (req.method === "POST") {
      if (!auth) return res.status(401).json({ error: "Unauthorized" });

      const owner = String(req.body?.owner || "").trim();
      const scope = String(req.body?.scope || "").trim() as Scope;
      const data = req.body?.data;

      if (!owner || !scope) return res.status(400).json({ error: "owner and scope are required" });

      if (owner !== "global" && auth.sub !== owner) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const up = await fetch(`${supa.url}/rest/v1/${TABLE}?on_conflict=owner,scope`, {
        method: "POST",
        headers: {
          ...supa.headers,
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify([{ owner, scope, data }]),
      });

      const text = await up.text();
      if (!up.ok) return res.status(up.status).send(text);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    await logServerError("api/cloud-state", error, {
      method: req?.method,
      owner: req?.query?.owner || req?.body?.owner,
      scope: req?.query?.scope || req?.body?.scope,
    });
    return res.status(500).json({ error: "Cloud state handler error" });
  }
}
