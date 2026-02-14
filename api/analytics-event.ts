type AnalyticsEventBody = {
  event?: string;
  payload?: Record<string, any>;
  ts?: number;
  path?: string;
  ua?: string;
};

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

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Analytics handler error",
    });
  }
}
