import crypto from "node:crypto";
import { logServerError } from "./_telemetry.js";

const TABLE = "app_state";
const OWNER = "global";
const SCOPE = "reviews";

type AgentReview = {
  id: string;
  rating: number;
  text: string;
  user: string;
  createdAt: number;
};

function b64urlDecode(s: string) {
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function getAuthSecret() {
  return process.env.ECHO_AUTH_SECRET || process.env.ECHO_AGENT_IDENTITY_SECRET || "dev_unsafe_echo_secret";
}

function verifyToken(authHeader?: string) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signature] = parts;
  const input = `${headerB64}.${payloadB64}`;
  const expected = crypto.createHmac("sha256", getAuthSecret()).update(input).digest("base64")
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

async function loadReviews(supa: { url: string; headers: Record<string, string> }) {
  const url = `${supa.url}/rest/v1/${TABLE}?owner=eq.${encodeURIComponent(OWNER)}&scope=eq.${encodeURIComponent(SCOPE)}&select=data&limit=1`;
  const resp = await fetch(url, { method: "GET", headers: supa.headers });
  const text = await resp.text();
  if (!resp.ok) throw new Error(text || `load reviews failed: ${resp.status}`);
  const rows = JSON.parse(text || "[]") as Array<{ data?: Record<string, AgentReview[]> }>;
  return rows?.[0]?.data || {};
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

  try {
    if (req.method === "GET") {
      const data = await loadReviews(supa);
      return res.status(200).json({ data });
    }

    if (req.method === "POST") {
      const auth = verifyToken(req.headers?.authorization || req.headers?.Authorization);
      if (!auth) return res.status(401).json({ error: "Unauthorized" });

      const agentId = String(req.body?.agentId || "").trim();
      const review = req.body?.review as AgentReview | undefined;
      if (!agentId || !review?.id) {
        return res.status(400).json({ error: "agentId and review are required" });
      }

      const current = await loadReviews(supa);
      const list = Array.isArray(current[agentId]) ? current[agentId] : [];
      const exists = list.some((r) => r.id === review.id);
      const nextList = exists ? list : [...list, review];
      const nextData = { ...current, [agentId]: nextList };

      const up = await fetch(`${supa.url}/rest/v1/${TABLE}?on_conflict=owner,scope`, {
        method: "POST",
        headers: {
          ...supa.headers,
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify([{ owner: OWNER, scope: SCOPE, data: nextData }]),
      });

      const text = await up.text();
      if (!up.ok) return res.status(up.status).send(text);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    await logServerError("api/reviews", error, {
      method: req?.method,
      agentId: req?.body?.agentId,
    });
    return res.status(500).json({ error: "Reviews handler error" });
  }
}

