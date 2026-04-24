import crypto from "node:crypto";
import { logServerError } from "./_telemetry.js";

type DailyAnalytics = {
  counts: Record<string, number>;
  revenueByAgent: Record<string, number>;
  totalRevenue: number;
};

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

function buildLast30DayScopes(): { date: string; scope: string }[] {
  const result: { date: string; scope: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    result.push({ date, scope: `analytics_daily:${date}` });
  }
  return result;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!getAuthSecret()) {
    return res.status(500).json({ error: "Auth secret is missing" });
  }

  const auth = verifyToken(req.headers?.authorization || req.headers?.Authorization);
  if (!auth) return res.status(401).json({ error: "Unauthorized" });

  const supa = serviceHeaders();
  if (!supa) {
    return res.status(500).json({ error: "Supabase service configuration missing" });
  }

  try {
    const days = buildLast30DayScopes();
    const scopeValues = days.map((d) => d.scope).join(",");

    const TABLE = "app_state";
    const OWNER = "global";
    const queryUrl =
      `${supa.url}/rest/v1/${TABLE}` +
      `?owner=eq.${encodeURIComponent(OWNER)}` +
      `&scope=in.(${scopeValues})` +
      `&select=scope,data` +
      `&limit=30`;

    const resp = await fetch(queryUrl, { method: "GET", headers: supa.headers });
    const text = await resp.text();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: text || "Failed to fetch analytics data" });
    }

    let rows: Array<{ scope: string; data?: DailyAnalytics }> = [];
    try {
      rows = JSON.parse(text || "[]");
    } catch {
      rows = [];
    }

    // Index rows by scope for quick lookup
    const rowByScope = new Map<string, DailyAnalytics>();
    for (const row of rows) {
      if (row.scope && row.data) {
        rowByScope.set(row.scope, row.data);
      }
    }

    // Aggregate totals and build daily chart
    const totalCounts: Record<string, number> = {};
    const revenueByAgent: Record<string, number> = {};
    let totalRevenue = 0;
    const dailyChart: Array<{ date: string; events: number; revenue: number }> = [];

    // days is newest-first; chart should be oldest-first so reverse
    for (const { date, scope } of [...days].reverse()) {
      const data = rowByScope.get(scope);
      let dayEvents = 0;
      let dayRevenue = 0;

      if (data) {
        // Merge counts
        if (data.counts && typeof data.counts === "object") {
          for (const [event, count] of Object.entries(data.counts)) {
            const n = Number(count) || 0;
            totalCounts[event] = (totalCounts[event] || 0) + n;
            dayEvents += n;
          }
        }
        // Merge revenueByAgent
        if (data.revenueByAgent && typeof data.revenueByAgent === "object") {
          for (const [agentId, amount] of Object.entries(data.revenueByAgent)) {
            const n = Number(amount) || 0;
            revenueByAgent[agentId] = (revenueByAgent[agentId] || 0) + n;
          }
        }
        // Merge totalRevenue
        const rev = typeof data.totalRevenue === "number" ? data.totalRevenue : 0;
        totalRevenue += rev;
        dayRevenue = rev;
      }

      dailyChart.push({ date, events: dayEvents, revenue: dayRevenue });
    }

    return res.status(200).json({
      totalCounts,
      totalRevenue,
      revenueByAgent,
      dailyChart,
      daysAvailable: rowByScope.size,
    });
  } catch (error: any) {
    await logServerError("api/analytics-summary", error, {
      method: req?.method,
    });
    return res.status(500).json({ error: "Analytics summary handler error" });
  }
}
