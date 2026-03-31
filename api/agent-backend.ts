import { createHmac, randomUUID } from "node:crypto";
import { URL } from "node:url";
import { logServerError } from "./_telemetry.js";

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

// Block requests to private/internal IP ranges (SSRF protection)
function isPrivateUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();

    // Block localhost variants
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") {
      return true;
    }

    // Block 0.0.0.0
    if (hostname === "0.0.0.0") return true;

    // Block private IP ranges
    const parts = hostname.split(".").map(Number);
    if (parts.length === 4 && parts.every((p) => !isNaN(p))) {
      // 10.0.0.0/8
      if (parts[0] === 10) return true;
      // 172.16.0.0/12
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      // 192.168.0.0/16
      if (parts[0] === 192 && parts[1] === 168) return true;
      // 169.254.0.0/16 (link-local)
      if (parts[0] === 169 && parts[1] === 254) return true;
    }

    // Block metadata endpoints (cloud providers)
    if (hostname === "metadata.google.internal") return true;
    if (hostname === "169.254.169.254") return true;

    return false;
  } catch {
    return true; // If we can't parse it, block it
  }
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

    if (isPrivateUrl(targetUrl)) {
      return res.status(403).json({ reply: "Requests to private/internal addresses are not allowed" });
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
    await logServerError("api/agent-backend", error, {
      method: req?.method,
      hasBody: !!req?.body,
    });
    return res.status(500).json({
      reply: error?.message || "Internal proxy error",
    });
  }
}
