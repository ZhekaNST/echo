import { logServerError } from "./_telemetry.js";

const TABLE = "app_state";

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

type LikeRow = {
  owner: string;
  data: Record<string, boolean> | null;
};

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const supa = serviceHeaders();
  if (!supa) return res.status(500).json({ error: "Supabase service configuration missing" });

  try {
    const url = `${supa.url}/rest/v1/${TABLE}?scope=eq.liked&select=owner,data&limit=1000`;
    const up = await fetch(url, { method: "GET", headers: supa.headers });
    const text = await up.text();
    if (!up.ok) return res.status(up.status).send(text);

    let rows: LikeRow[] = [];
    try {
      rows = JSON.parse(text || "[]");
    } catch {
      rows = [];
    }

    const likesByAgent: Record<string, number> = {};

    for (const row of rows) {
      const likedMap = row?.data;
      if (!likedMap || typeof likedMap !== "object") continue;
      for (const [agentId, isLiked] of Object.entries(likedMap)) {
        if (!isLiked) continue;
        likesByAgent[agentId] = (likesByAgent[agentId] || 0) + 1;
      }
    }

    return res.status(200).json({ likesByAgent });
  } catch (error: any) {
    await logServerError("api/agent-stats", error, {
      method: req?.method,
    });
    return res.status(500).json({ error: "Agent stats handler error" });
  }
}

