import { createHmac, randomUUID } from "node:crypto";

type BackendAuthMode = "echo_key" | "verified_identity";

type AgentBackendRequest = {
  agentId?: string;
  targetUrl?: string;
  authToken?: string | null;
  backendAuthMode?: BackendAuthMode;
  identityHeaderName?: string | null;
  identityVerifyUrl?: string | null;
  identityAppKey?: string | null;
  messages?: Array<{
    role: string;
    content: string;
    attachments?: Array<{
      name?: string;
      kind?: string;
      ext?: string;
      mime?: string;
    }>;
  }>;
};

function base64url(input: string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildIdentityToken(agentId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "echo",
    sub: agentId || "unknown-agent",
    iat: now,
    exp: now + 300, // 5 minutes
    jti: randomUUID(),
  };

  const secret = process.env.ECHO_AGENT_IDENTITY_SECRET;
  if (!secret) {
    // Dev-friendly fallback token when no signing secret is configured.
    return `echo_unsafe_${base64url(JSON.stringify(payload))}`;
  }

  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${signingInput}.${signature}`;
}

function normalizeHeaderName(raw?: string | null): string {
  const fallback = "x-echo-identity";
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return fallback;
  // Only allow safe HTTP header-name characters
  if (!/^[a-z0-9-]+$/.test(normalized)) return fallback;
  return normalized;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ reply: "Method not allowed" });
  }

  try {
    const body: AgentBackendRequest = req.body || {};
    const targetUrl = (body.targetUrl || "").trim();
    const agentId = (body.agentId || "").trim();
    const backendAuthMode: BackendAuthMode =
      body.backendAuthMode === "verified_identity"
        ? "verified_identity"
        : "echo_key";

    if (!targetUrl) {
      return res.status(400).json({ reply: "Missing targetUrl" });
    }

    if (!/^https?:\/\//i.test(targetUrl)) {
      return res.status(400).json({ reply: "targetUrl must be a valid http(s) URL" });
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-echo-agent-id": agentId || "unknown-agent",
    };

    if (backendAuthMode === "verified_identity") {
      const headerName = normalizeHeaderName(body.identityHeaderName);
      headers[headerName] = buildIdentityToken(agentId || "unknown-agent");

      if ((body.identityVerifyUrl || "").trim()) {
        headers["x-echo-identity-verify-url"] = String(body.identityVerifyUrl);
      }
      if ((body.identityAppKey || "").trim()) {
        headers["x-echo-identity-app-key"] = String(body.identityAppKey);
      }
    } else if ((body.authToken || "").trim()) {
      headers["x-echo-key"] = String(body.authToken);
    }

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentId,
        messages: body.messages || [],
      }),
    });

    const raw = await upstream.text();
    const ct = upstream.headers.get("content-type") || "";
    res.status(upstream.status);

    if (ct.includes("application/json")) {
      res.setHeader("Content-Type", "application/json");
      return res.send(raw);
    }

    res.setHeader("Content-Type", "application/json");
    return res.send(
      JSON.stringify({
        reply: raw.slice(0, 3000),
        nonJsonUpstream: true,
        upstreamContentType: ct || "unknown",
      })
    );
  } catch (error: any) {
    return res.status(500).json({
      reply: error?.message || "Internal proxy error",
    });
  }
}
