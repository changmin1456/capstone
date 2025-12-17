export async function readHttpErrorMessage(res: Response): Promise<string> {
  // Try JSON first (common: { error }, FastAPI: { detail })
  try {
    const data = await res.clone().json();
    const msg =
      (data && typeof data === "object" && (data.error || data.detail || data.message)) ||
      null;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  } catch {
    // ignore
  }

  // Fallback to text
  try {
    const text = (await res.clone().text()).trim();
    if (text) return text;
  } catch {
    // ignore
  }

  return `HTTP ${res.status}`;
}
