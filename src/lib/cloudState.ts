export type CloudStateScope = "agents" | "liked" | "saved" | "purchases" | "reviews" | "sessions";

const CLOUD_TOKEN_KEY = "echo:cloud_token:v1";

export function getCloudToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(CLOUD_TOKEN_KEY);
}

export function setCloudToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (!token) {
    localStorage.removeItem(CLOUD_TOKEN_KEY);
    return;
  }
  localStorage.setItem(CLOUD_TOKEN_KEY, token);
}

export function isCloudEnabled() {
  return true;
}

export async function loadCloudState<T>(owner: string, scope: CloudStateScope, token?: string | null): Promise<T | null> {
  try {
    const res = await fetch(`/api/cloud-state?owner=${encodeURIComponent(owner)}&scope=${encodeURIComponent(scope)}`, {
      method: "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!res.ok) return null;
    const body = (await res.json()) as { data?: T | null };
    return body?.data ?? null;
  } catch {
    return null;
  }
}

export async function saveCloudState(
  owner: string,
  scope: CloudStateScope,
  data: unknown,
  token?: string | null
): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch("/api/cloud-state", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ owner, scope, data }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
