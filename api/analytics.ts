// Combined analytics endpoint:
//   POST /api/analytics  → record an event + update daily aggregate
//   GET  /api/analytics  → admin summary (last 30 days, requires JWT)
//
// Merged from former api/analytics-event.ts + api/analytics-summary.ts so we
// stay under the 12-function Hobby cap when adding new vendor endpoints.

import crypto from "node:crypto";
import { logServerError } from "./_telemetry.js";

type AnalyticsEventBody = {
  event?: string;
  payload?: Record<string, any>;
  ts?: number;
  path?: string;
  ua?: string;
};

type DailyAnalytics = {
  counts: Record<string, number>;
  revenueByAgent: Record<string, number>;
  totalRevenue: number;
};

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

// ─── Auth (admin GET) ────────────────────────────────────────────────────────

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
  const expected = crypto
    .createHmac("sha256", secret)
    .update(input)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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

// ─── POST: record event + update daily aggregate ─────────────────────────────

async function updateDailyAggregate(normalized: {
  event: string;
  payload: Record<string, any>;
}): Promise<void> {
  const supa = serviceHeaders();
  if (!supa) return;

  const today = new Date().toISOString().slice(0, 10);
  const scope = `analytics_daily:${today}`;
  const TABLE = "app_state";
  const OWNER = "global";

  const getUrl =
    `${supa.url}/rest/v1/${TABLE}?owner=eq.${encodeURIComponent(OWNER)}&scope=eq.${encodeURIComponent(scope)}&select=data&limit=1`;
  const getResp = await fetch(getUrl, { method: "GET", headers: supa.headers });
  const getText = await getResp.text();
  let current: DailyAnalytics = { counts: {}, revenueByAgent: {}, totalRevenue: 0 };
  if (getResp.ok) {
    try {
      const rows = JSON.parse(getText || "[]") as Array<{ data?: DailyAnalytics }>;
      if (rows?.[0]?.data) {
        const d = rows[0].data;
        current = {
          counts: d.counts && typeof d.counts === "object" ? d.counts : {},
          revenueByAgent:
            d.revenueByAgent && typeof d.revenueByAgent === "object" ? d.revenueByAgent : {},
          totalRevenue: typeof d.totalRevenue === "number" ? d.totalRevenue : 0,
        };
      }
    } catch {
      // leave current as default
    }
  }

  current.counts[normalized.event] = (current.counts[normalized.event] || 0) + 1;

  if (normalized.event === "pay_success") {
    const amountUsdc = Number(normalized.payload?.amountUsdc) || 0;
    const agentId = String(normalized.payload?.agentId || "");
    if (agentId) {
      current.revenueByAgent[agentId] =
        (current.revenueByAgent[agentId] || 0) + amountUsdc;
    }
    current.totalRevenue = (current.totalRevenue || 0) + amountUsdc;
  }

  await fetch(`${supa.url}/rest/v1/${TABLE}?on_conflict=owner,scope`, {
    method: "POST",
    headers: {
      ...supa.headers,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([{ owner: OWNER, scope, data: current }]),
  });
}

async function handlePost(req: any, res: any) {
  try {
    const body: AnalyticsEventBody = req.body || {};
    if (!body.event || typeof body.event !== "string") {
      return res.status(400).json({ ok: false, error: "Missing event" });
    }

    const normalized = {
      event: body.event,
      payload: body.payload || {},
      ts: typeof body.ts === "number" ? body.ts : Date.now(),
      path: body.path || "",
      ua: body.ua || req.headers["user-agent"] || "",
    };

    console.log("[ANALYTICS]", JSON.stringify(normalized));

    const webhookUrl = process.env.ANALYTICS_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalized),
        });
      } catch (forwardErr: any) {
        console.warn("[ANALYTICS] webhook forward failed:", forwardErr?.message);
      }
    }

    res.status(200).json({ ok: true });
    updateDailyAggregate(normalized).catch(() => {});
  } catch (error: any) {
    await logServerError("api/analytics:post", error, {
      method: req?.method,
      hasEvent: !!req?.body?.event,
    });
    return res.status(500).json({
      ok: false,
      error: error?.message || "Analytics handler error",
    });
  }
}

// ─── GET: admin summary (last 30 days) ───────────────────────────────────────

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

async function handleGet(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");

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

    const rowByScope = new Map<string, DailyAnalytics>();
    for (const row of rows) {
      if (row.scope && row.data) rowByScope.set(row.scope, row.data);
    }

    const totalCounts: Record<string, number> = {};
    const revenueByAgent: Record<string, number> = {};
    let totalRevenue = 0;
    const dailyChart: Array<{ date: string; events: number; revenue: number }> = [];

    for (const { date, scope } of [...days].reverse()) {
      const data = rowByScope.get(scope);
      let dayEvents = 0;
      let dayRevenue = 0;

      if (data) {
        if (data.counts && typeof data.counts === "object") {
          for (const [event, count] of Object.entries(data.counts)) {
            const n = Number(count) || 0;
            totalCounts[event] = (totalCounts[event] || 0) + n;
            dayEvents += n;
          }
        }
        if (data.revenueByAgent && typeof data.revenueByAgent === "object") {
          for (const [agentId, amount] of Object.entries(data.revenueByAgent)) {
            const n = Number(amount) || 0;
            revenueByAgent[agentId] = (revenueByAgent[agentId] || 0) + n;
          }
        }
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
    await logServerError("api/analytics:get", error, { method: req?.method });
    return res.status(500).json({ error: "Analytics summary handler error" });
  }
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "POST") return handlePost(req, res);
  if (req.method === "GET") return handleGet(req, res);

  res.setHeader("Allow", "GET, POST, OPTIONS");
  return res.status(405).json({ ok: false, error: "Method not allowed" });
}
