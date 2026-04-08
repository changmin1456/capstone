const AUTH_TOKEN_KEY = "capston.authToken";

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string) {
  try {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export function clearAuthToken() {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function getAuthEmail(): string | null {
  const token = getAuthToken();
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "===".slice((payload.length + 3) % 4);
  try {
    const decoded = atob(padded);
    const obj = JSON.parse(decoded) as { email?: unknown };
    return typeof obj.email === "string" ? obj.email : null;
  } catch {
    return null;
  }
}
