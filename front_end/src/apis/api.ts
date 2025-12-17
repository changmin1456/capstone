declare global {
  interface Window {
    __API_BASE__?: string;
  }
}

const envApiBase = import.meta.env.VITE_API_BASE || undefined;
const runtimeApiBase = typeof window !== "undefined" ? window.__API_BASE__ : undefined;
// 기본값을 Node 서버(3000)로 두고, 필요 시 VITE_API_BASE로 오버라이드
export const API_BASE = envApiBase ?? runtimeApiBase ?? "http://localhost:3000";

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = (() => {
    try {
      return localStorage.getItem("capston.authToken");
    } catch {
      return null;
    }
  })();

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return undefined as T;
  return (await res.json()) as T;
}
