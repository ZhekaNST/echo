const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const TABLE = "app_state";

function hasConfig() {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
}

function endpoint(path: string) {
  return `${SUPABASE_URL}${path}`;
}

function headers() {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY as string,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };
}

export type CloudStateScope = "agents" | "liked" | "saved" | "purchases" | "reviews";

export async function loadCloudState<T>(owner: string, scope: CloudStateScope): Promise<T | null> {
  if (!hasConfig()) return null;
  const url = endpoint(
    `/rest/v1/${TABLE}?owner=eq.${encodeURIComponent(owner)}&scope=eq.${encodeURIComponent(scope)}&select=data&limit=1`
  );

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...headers(),
      },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ data: T }>;
    return rows?.[0]?.data ?? null;
  } catch {
    return null;
  }
}

export async function saveCloudState(owner: string, scope: CloudStateScope, data: unknown): Promise<boolean> {
  if (!hasConfig()) return false;

  try {
    const res = await fetch(endpoint(`/rest/v1/${TABLE}`), {
      method: "POST",
      headers: {
        ...headers(),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([
        {
          owner,
          scope,
          data,
        },
      ]),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function isCloudEnabled() {
  return hasConfig();
}
