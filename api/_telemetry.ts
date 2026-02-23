type TelemetryEvent = {
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  details?: Record<string, unknown>;
  ts?: number;
};

function normalizeError(error: unknown) {
  if (!error) return {};
  if (typeof error === "string") return { error };
  const anyErr = error as any;
  return {
    name: anyErr?.name,
    message: anyErr?.message,
    stack: anyErr?.stack,
  };
}

export async function logTelemetry(event: TelemetryEvent) {
  const normalized = {
    ...event,
    ts: event.ts || Date.now(),
  };

  try {
    const line = `[TELEMETRY][${normalized.level.toUpperCase()}][${normalized.source}] ${normalized.message}`;
    if (normalized.level === "error") console.error(line, normalized.details || {});
    else if (normalized.level === "warn") console.warn(line, normalized.details || {});
    else console.log(line, normalized.details || {});
  } catch {
    // non-blocking
  }

  const webhookUrl = process.env.TELEMETRY_WEBHOOK_URL || process.env.ANALYTICS_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "server_telemetry", ...normalized }),
    });
  } catch (forwardErr: any) {
    try {
      console.warn("[TELEMETRY] webhook forward failed:", forwardErr?.message || "Unknown error");
    } catch {
      // non-blocking
    }
  }
}

export async function logServerError(
  source: string,
  error: unknown,
  details?: Record<string, unknown>
) {
  return logTelemetry({
    level: "error",
    source,
    message: "Unhandled server error",
    details: {
      ...details,
      ...normalizeError(error),
    },
  });
}
