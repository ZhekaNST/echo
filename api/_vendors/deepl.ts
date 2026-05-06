// DeepL translation vendor handler.
// API docs: https://developers.deepl.com/docs/api-reference/translate
//
// Two endpoints exist — Pro (api.deepl.com) and Free (api-free.deepl.com).
// We auto-detect based on the API key suffix (`:fx` => free) but allow override.

const DEEPL_PRO_BASE = "https://api.deepl.com/v2";
const DEEPL_FREE_BASE = "https://api-free.deepl.com/v2";

const MAX_TEXT_LENGTH = 5000;

// ISO codes accepted by DeepL's `target_lang` field.
// Source: https://developers.deepl.com/docs/getting-started/supported-languages
const DEEPL_TARGET_LANGS = new Set([
  "AR", "BG", "CS", "DA", "DE", "EL", "EN", "EN-GB", "EN-US",
  "ES", "ET", "FI", "FR", "HU", "ID", "IT", "JA", "KO", "LT",
  "LV", "NB", "NL", "PL", "PT", "PT-BR", "PT-PT", "RO", "RU",
  "SK", "SL", "SV", "TR", "UK", "ZH", "ZH-HANS", "ZH-HANT",
]);

export type DeepLPayload = {
  text?: string;
  targetLang?: string;
  sourceLang?: string;
};

export type DeepLResult = {
  translatedText: string;
  detectedSourceLang: string;
  targetLang: string;
  characters: number;
};

export class VendorError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function getDeepLBase(apiKey: string): string {
  // DeepL convention: free-tier keys end with `:fx`.
  if (process.env.DEEPL_API_BASE) return process.env.DEEPL_API_BASE.replace(/\/+$/, "");
  return apiKey.endsWith(":fx") ? DEEPL_FREE_BASE : DEEPL_PRO_BASE;
}

export async function callDeepL(payload: DeepLPayload): Promise<DeepLResult> {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    throw new VendorError("DeepL is not configured on the server.", 503);
  }

  const text = (payload.text || "").trim();
  if (!text) throw new VendorError("Text to translate is required.", 400);
  if (text.length > MAX_TEXT_LENGTH) {
    throw new VendorError(`Text too long (max ${MAX_TEXT_LENGTH} chars).`, 413);
  }

  const targetLang = String(payload.targetLang || "EN-US").toUpperCase();
  if (!DEEPL_TARGET_LANGS.has(targetLang)) {
    throw new VendorError(`Unsupported target language: ${targetLang}`, 400);
  }

  const sourceLang =
    payload.sourceLang && String(payload.sourceLang).trim()
      ? String(payload.sourceLang).trim().toUpperCase()
      : null;

  const body: Record<string, any> = {
    text: [text],
    target_lang: targetLang,
  };
  if (sourceLang) body.source_lang = sourceLang;

  const base = getDeepLBase(apiKey);
  const resp = await fetch(`${base}/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    let detail = "";
    try {
      detail = await resp.text();
    } catch {
      /* ignore */
    }
    if (resp.status === 456) {
      throw new VendorError("DeepL quota exceeded for this API key.", 429);
    }
    throw new VendorError(
      `DeepL request failed (${resp.status}): ${detail.slice(0, 240) || "no detail"}`,
      resp.status >= 500 ? 502 : resp.status
    );
  }

  const data = await resp.json().catch(() => null) as
    | { translations?: Array<{ text?: string; detected_source_language?: string }> }
    | null;

  const first = data?.translations?.[0];
  if (!first?.text) {
    throw new VendorError("DeepL returned an empty translation.", 502);
  }

  return {
    translatedText: first.text,
    detectedSourceLang: first.detected_source_language || sourceLang || "AUTO",
    targetLang,
    characters: text.length,
  };
}

export const DEEPL_LIMITS = {
  maxTextLength: MAX_TEXT_LENGTH,
  supportedTargets: Array.from(DEEPL_TARGET_LANGS),
};
