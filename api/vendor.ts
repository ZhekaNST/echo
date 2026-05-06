// Generic vendor proxy for built-in third-party agents (DeepL, Otter, PhotoRoom, …).
// Each vendor handler lives in api/_vendors/<name>.ts and is dispatched here.
// Single endpoint keeps us under the 12-function Hobby cap and centralizes
// auth + rate limiting.

import { callDeepL, VendorError, type DeepLPayload } from "./_vendors/deepl.js";
import { logServerError } from "./_telemetry.js";

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 12;

type RateLimitEntry = { count: number; resetAt: number };
const rateLimitStore = new Map<string, RateLimitEntry>();

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const RATE_LIMIT_WINDOW_MS = parsePositiveInt(
  process.env.VENDOR_RATE_LIMIT_WINDOW_MS,
  DEFAULT_RATE_LIMIT_WINDOW_MS
);
const RATE_LIMIT_MAX_REQUESTS = parsePositiveInt(
  process.env.VENDOR_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_RATE_LIMIT_MAX_REQUESTS
);

function getClientIp(req: any): string {
  const header = req.headers?.["x-forwarded-for"] || req.headers?.["X-Forwarded-For"];
  if (typeof header === "string" && header.trim()) {
    return header.split(",")[0].trim();
  }
  if (Array.isArray(header) && header.length > 0) {
    return String(header[0]).split(",")[0].trim();
  }
  return String(req.socket?.remoteAddress || "unknown-ip");
}

function getRateLimitKey(req: any, vendor: string): string {
  const ip = getClientIp(req);
  const ua = String(req.headers?.["user-agent"] || "unknown-ua").slice(0, 80);
  return `${vendor}:${ip}:${ua}`;
}

function consumeRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  for (const [k, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= now) rateLimitStore.delete(k);
  }
  const existing = rateLimitStore.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSec: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) };
  }
  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  existing.count += 1;
  rateLimitStore.set(key, existing);
  return { allowed: true, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
}

type VendorRequestBody = {
  vendor?: string;
  payload?: Record<string, unknown>;
};

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let body: VendorRequestBody = {};
  try {
    body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) || {};
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON body" });
  }

  const vendor = String(body.vendor || "").toLowerCase().trim();
  if (!vendor) {
    return res.status(400).json({ ok: false, error: "Missing 'vendor' field" });
  }

  const rl = consumeRateLimit(getRateLimitKey(req, vendor));
  if (!rl.allowed) {
    res.setHeader("Retry-After", String(rl.retryAfterSec));
    return res.status(429).json({
      ok: false,
      error: `Rate limit exceeded. Try again in ${rl.retryAfterSec}s.`,
    });
  }

  try {
    switch (vendor) {
      case "deepl": {
        const result = await callDeepL((body.payload || {}) as DeepLPayload);
        return res.status(200).json({ ok: true, vendor: "deepl", result });
      }
      default:
        return res.status(404).json({ ok: false, error: `Unknown vendor: ${vendor}` });
    }
  } catch (error: any) {
    if (error instanceof VendorError) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    await logServerError("api/vendor", error, { vendor });
    return res.status(500).json({
      ok: false,
      error: error?.message || "Vendor handler error",
    });
  }
}
