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

  // Fetch current aggregate
  const getUrl = `${supa.url}/rest/v1/${TABLE}?owner=eq.${encodeURIComponent(OWNER)}&scope=eq.${encodeURIComponent(scope)}&select=data&limit=1`;
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
          revenueByAgent: d.revenueByAgent && typeof d.revenueByAgent === "object" ? d.revenueByAgent : {},
          totalRevenue: typeof d.totalRevenue === "number" ? d.totalRevenue : 0,
        };
      }
    } catch {
      // leave current as default
    }
  }

  // Increment event count
  current.counts[normalized.event] = (current.counts[normalized.event] || 0) + 1;

  // Handle pay_success revenue
  if (normalized.event === "pay_success") {
    const amountUsdc = Number(normalized.payload?.amountUsdc) || 0;
    const agentId = String(normalized.payload?.agentId || "");
    if (agentId) {
      current.revenueByAgent[agentId] = (current.revenueByAgent[agentId] || 0) + amountUsdc;
    }
    current.totalRevenue = (current.totalRevenue || 0) + amountUsdc;
  }

  // Upsert back
  await fetch(`${supa.url}/rest/v1/${TABLE}?on_conflict=owner,scope`, {
    method: "POST",
    headers: {
      ...supa.headers,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([{ owner: OWNER, scope, data: current }]),
  });
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

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

    // Respond to the client first, then update the daily aggregate fire-and-forget
    res.status(200).json({ ok: true });

    updateDailyAggregate(normalized).catch(() => {});
  } catch (error: any) {
    await logServerError("api/analytics-event", error, {
      method: req?.method,
      hasEvent: !!req?.body?.event,
    });
    return res.status(500).json({
      ok: false,
      error: error?.message || "Analytics handler error",
    });
  }
}
