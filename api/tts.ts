// Vercel serverless function for ElevenLabs Text-to-Speech
// Security: API key loaded from environment variables only

const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const MAX_TEXT_LENGTH = 2000;
const MIN_TEXT_LENGTH = 1;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 8;

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const ttsRateLimitStore = new Map<string, RateLimitEntry>();

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const TTS_RATE_LIMIT_WINDOW_MS = parsePositiveInt(
  process.env.TTS_RATE_LIMIT_WINDOW_MS,
  DEFAULT_RATE_LIMIT_WINDOW_MS
);
const TTS_RATE_LIMIT_MAX_REQUESTS = parsePositiveInt(
  process.env.TTS_RATE_LIMIT_MAX_REQUESTS,
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

function getRateLimitKey(req: any): string {
  const ip = getClientIp(req);
  const ua = String(req.headers?.["user-agent"] || req.headers?.["User-Agent"] || "unknown-ua");
  return `${ip}:${ua.slice(0, 80)}`;
}

function cleanupRateLimitStore(now: number): void {
  for (const [key, entry] of ttsRateLimitStore.entries()) {
    if (entry.resetAt <= now) {
      ttsRateLimitStore.delete(key);
    }
  }
}

function consumeRateLimit(key: string): { allowed: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  cleanupRateLimitStore(now);

  const existing = ttsRateLimitStore.get(key);
  if (!existing || existing.resetAt <= now) {
    ttsRateLimitStore.set(key, {
      count: 1,
      resetAt: now + TTS_RATE_LIMIT_WINDOW_MS,
    });
    return {
      allowed: true,
      remaining: Math.max(0, TTS_RATE_LIMIT_MAX_REQUESTS - 1),
      retryAfterSec: Math.ceil(TTS_RATE_LIMIT_WINDOW_MS / 1000),
    };
  }

  if (existing.count >= TTS_RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  ttsRateLimitStore.set(key, existing);
  return {
    allowed: true,
    remaining: Math.max(0, TTS_RATE_LIMIT_MAX_REQUESTS - existing.count),
    retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

interface VoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
}

interface TTSRequest {
  text?: string;
  voiceId?: string;
  modelId?: string;
  voiceSettings?: VoiceSettings;
}

interface ErrorResponse {
  error: {
    message: string;
    code: string;
  };
}

export default async function handler(
  req: any,
  res: any,
) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    return sendError(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
  }

  const rateLimitKey = getRateLimitKey(req);
  const limit = consumeRateLimit(rateLimitKey);
  res.setHeader("X-RateLimit-Limit", String(TTS_RATE_LIMIT_MAX_REQUESTS));
  res.setHeader("X-RateLimit-Remaining", String(limit.remaining));
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSec));
    return sendError(
      res,
      429,
      `Too many TTS requests. Try again in ${limit.retryAfterSec}s.`,
      "RATE_LIMITED_SERVER"
    );
  }

  // Get API key from environment - NEVER log this
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("TTS Error: ELEVENLABS_API_KEY not configured");
    return sendError(res, 500, "TTS service not configured", "SERVICE_NOT_CONFIGURED");
  }

  try {
    const body: TTSRequest = req.body || {};
    
    // Validate text
    const text = typeof body.text === "string" ? body.text.trim() : "";
    
    if (!text) {
      return sendError(res, 400, "Text is required", "TEXT_REQUIRED");
    }
    
    if (text.length < MIN_TEXT_LENGTH) {
      return sendError(res, 400, "Text is too short", "TEXT_TOO_SHORT");
    }
    
    if (text.length > MAX_TEXT_LENGTH) {
      return sendError(
        res, 
        400, 
        `Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`, 
        "TEXT_TOO_LONG"
      );
    }

    // Get voice ID (from request or environment default)
    const voiceId = body.voiceId || process.env.ELEVENLABS_VOICE_ID;
    if (!voiceId) {
      return sendError(
        res, 
        400, 
        "Voice ID is required (set ELEVENLABS_VOICE_ID or pass voiceId)", 
        "VOICE_ID_REQUIRED"
      );
    }

    // Get model ID (default to multilingual v2)
    const modelId = body.modelId || DEFAULT_MODEL_ID;

    // Call ElevenLabs API
    const elevenLabsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    
    // Log request (without sensitive data)
    console.log(`TTS Request: voice=${voiceId}, model=${modelId}, textLength=${text.length}`);

    // Build voice settings from request or use defaults
    const voiceSettingsFromRequest = body.voiceSettings || {};
    const finalVoiceSettings = {
      stability: voiceSettingsFromRequest.stability ?? 0.5,
      similarity_boost: voiceSettingsFromRequest.similarity_boost ?? 0.75,
      style: voiceSettingsFromRequest.style ?? 0.0,
      use_speaker_boost: voiceSettingsFromRequest.use_speaker_boost ?? true,
    };

    const elevenLabsResponse = await fetch(elevenLabsUrl, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: finalVoiceSettings,
      }),
    });

    // Handle non-2xx responses from ElevenLabs
    if (!elevenLabsResponse.ok) {
      let errorMessage = "ElevenLabs API error";
      let errorDetails = "";
      
      try {
        const errorBody = await elevenLabsResponse.text();
        try {
          const errorJson = JSON.parse(errorBody);
          errorDetails = errorJson.detail?.message || errorJson.message || errorBody;
        } catch {
          errorDetails = errorBody;
        }
      } catch {
        errorDetails = `Status ${elevenLabsResponse.status}`;
      }
      
      console.error(`TTS ElevenLabs Error: ${elevenLabsResponse.status} - ${errorDetails}`);
      
      // Map common errors
      if (elevenLabsResponse.status === 401) {
        return sendError(res, 502, "TTS authentication failed", "AUTH_FAILED");
      }
      if (elevenLabsResponse.status === 422) {
        return sendError(res, 400, `Invalid request: ${errorDetails}`, "INVALID_REQUEST");
      }
      if (elevenLabsResponse.status === 429) {
        return sendError(res, 429, "Rate limit exceeded. Please try again later.", "RATE_LIMITED");
      }
      
      return sendError(
        res, 
        502, 
        `TTS service error: ${errorDetails}`, 
        "ELEVENLABS_ERROR"
      );
    }

    // Get audio data as buffer
    const audioBuffer = await elevenLabsResponse.arrayBuffer();
    
    // Return audio directly
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Length", audioBuffer.byteLength);
    res.status(200).send(Buffer.from(audioBuffer));
    
  } catch (error: any) {
    console.error("TTS Handler Error:", error?.message || error);
    return sendError(
      res, 
      500, 
      "Internal server error during TTS processing", 
      "INTERNAL_ERROR"
    );
  }
}

function sendError(
  res: any, 
  status: number, 
  message: string, 
  code: string
): void {
  const errorResponse: ErrorResponse = {
    error: {
      message,
      code,
    },
  };
  res.status(status).json(errorResponse);
}
