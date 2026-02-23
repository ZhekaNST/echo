import crypto from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";

type ChallengeRecord = {
  nonce: string;
  wallet: string;
  message: string;
  expiresAt: number;
};

const challenges = new Map<string, ChallengeRecord>();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_SEC = 24 * 60 * 60;

function cleanupChallenges() {
  const now = Date.now();
  for (const [key, rec] of challenges.entries()) {
    if (rec.expiresAt <= now) challenges.delete(key);
  }
}

function getAuthSecret() {
  return process.env.ECHO_AUTH_SECRET || process.env.ECHO_AGENT_IDENTITY_SECRET || "dev_unsafe_echo_secret";
}

function b64url(input: string | Buffer) {
  const s = Buffer.isBuffer(input) ? input.toString("base64") : Buffer.from(input).toString("base64");
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function signToken(payload: Record<string, unknown>) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(payload));
  const input = `${encodedHeader}.${encodedPayload}`;
  const sig = crypto.createHmac("sha256", getAuthSecret()).update(input).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${input}.${sig}`;
}

function validWallet(wallet: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet);
}

function decodeSig(sig: string): Uint8Array | null {
  try {
    return new Uint8Array(Buffer.from(sig, "base64"));
  } catch {
    try {
      return bs58.decode(sig);
    } catch {
      return null;
    }
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  cleanupChallenges();

  const action = req.body?.action;

  if (action === "challenge") {
    const wallet = String(req.body?.wallet || "").trim();
    if (!validWallet(wallet)) return res.status(400).json({ error: "Invalid wallet" });

    const nonce = crypto.randomBytes(16).toString("hex");
    const challengeId = crypto.randomUUID();
    const message = `Echo auth\nWallet: ${wallet}\nNonce: ${nonce}`;
    const expiresAt = Date.now() + CHALLENGE_TTL_MS;

    challenges.set(challengeId, { nonce, wallet, message, expiresAt });
    return res.status(200).json({ challengeId, message, expiresAt });
  }

  if (action === "verify") {
    const challengeId = String(req.body?.challengeId || "").trim();
    const wallet = String(req.body?.wallet || "").trim();
    const signature = String(req.body?.signature || "").trim();

    const challenge = challenges.get(challengeId);
    if (!challenge) return res.status(400).json({ error: "Challenge not found or expired" });
    if (challenge.expiresAt <= Date.now()) {
      challenges.delete(challengeId);
      return res.status(400).json({ error: "Challenge expired" });
    }
    if (challenge.wallet !== wallet) return res.status(400).json({ error: "Wallet mismatch" });

    const sigBytes = decodeSig(signature);
    if (!sigBytes) return res.status(400).json({ error: "Invalid signature encoding" });

    try {
      const pubkey = bs58.decode(wallet);
      const msgBytes = new TextEncoder().encode(challenge.message);
      const ok = nacl.sign.detached.verify(msgBytes, sigBytes, pubkey);
      if (!ok) return res.status(401).json({ error: "Signature verification failed" });

      const now = Math.floor(Date.now() / 1000);
      const token = signToken({ sub: wallet, role: "wallet", iat: now, exp: now + TOKEN_TTL_SEC });
      challenges.delete(challengeId);
      return res.status(200).json({ token, owner: wallet, expiresAt: (now + TOKEN_TTL_SEC) * 1000 });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Verification error" });
    }
  }

  return res.status(400).json({ error: "Unknown action" });
}
