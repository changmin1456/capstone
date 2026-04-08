import { apiFetch } from "./api";
import { clearAuthToken, setAuthToken } from "../utils/auth.ts";

export type AuthUser = {
  id: string;
  email: string;
  role?: "admin" | "user";
};

export type AuthResponse = {
  token: string;
  user?: AuthUser;
};

export async function apiLogin(payload: { email: string; password: string }): Promise<AuthResponse> {
  const res = await apiFetch<AuthResponse>("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res?.token) throw new Error("Login failed: missing token");
  setAuthToken(res.token);
  return res;
}

export async function apiRegister(payload: { email: string; password: string }): Promise<AuthResponse> {
  const res = await apiFetch<AuthResponse>("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Many APIs log you in immediately after register; we support both.
  if (res?.token) setAuthToken(res.token);
  return res;
}

export async function apiLogout(): Promise<void> {
  // server-side logout not required for JWT by default
  clearAuthToken();
}

export async function apiDeleteAccount(): Promise<void> {
  await apiFetch<void>("/api/auth/me", { method: "DELETE" });
  clearAuthToken();
}

export async function apiChangePassword(payload: { currentPassword: string; newPassword: string }): Promise<void> {
  await apiFetch<void>("/api/auth/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
