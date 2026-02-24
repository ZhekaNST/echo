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

type SessionRow = {
  owner: string;
  data: Record<string, number> | null;
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
    const [likesResp, sessionsResp] = await Promise.all([
      fetch(`${supa.url}/rest/v1/${TABLE}?scope=eq.liked&select=owner,data&limit=1000`, {
        method: "GET",
        headers: supa.headers,
      }),
      fetch(`${supa.url}/rest/v1/${TABLE}?scope=eq.sessions&select=owner,data&limit=1000`, {
        method: "GET",
        headers: supa.headers,
      }),
    ]);

    const likesText = await likesResp.text();
    if (!likesResp.ok) return res.status(likesResp.status).send(likesText);
    const sessionsText = await sessionsResp.text();
    if (!sessionsResp.ok) return res.status(sessionsResp.status).send(sessionsText);

    let likeRows: LikeRow[] = [];
    let sessionRows: SessionRow[] = [];
    try {
      likeRows = JSON.parse(likesText || "[]");
    } catch {
      likeRows = [];
    }
    try {
      sessionRows = JSON.parse(sessionsText || "[]");
    } catch {
      sessionRows = [];
    }

    const likesByAgent: Record<string, number> = {};
    const sessionsByAgent: Record<string, number> = {};

    for (const row of likeRows) {
      const likedMap = row?.data;
      if (!likedMap || typeof likedMap !== "object") continue;
      for (const [agentId, isLiked] of Object.entries(likedMap)) {
        if (!isLiked) continue;
        likesByAgent[agentId] = (likesByAgent[agentId] || 0) + 1;
      }
    }

    for (const row of sessionRows) {
      const sessionMap = row?.data;
      if (!sessionMap || typeof sessionMap !== "object") continue;
      for (const [agentId, count] of Object.entries(sessionMap)) {
        const n = Number(count) || 0;
        if (n <= 0) continue;
        sessionsByAgent[agentId] = (sessionsByAgent[agentId] || 0) + n;
      }
    }

    return res.status(200).json({ likesByAgent, sessionsByAgent });
  } catch (error: any) {
    await logServerError("api/agent-stats", error, {
      method: req?.method,
    });
    return res.status(500).json({ error: "Agent stats handler error" });
  }
}
