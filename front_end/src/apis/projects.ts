import { apiFetch } from "./api";

export type Project = {
  _id?: string;
  id?: string;
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
};

function normalizeProject(raw: Project): Project {
  const fallbackId = raw._id || raw.id;
  return { ...raw, _id: fallbackId };
}

export async function apiGetProjects(): Promise<Project[]> {
  const data = await apiFetch<unknown>("/api/projects");
  if (Array.isArray(data)) return (data as Project[]).map(normalizeProject).filter((p) => p._id);
  if (data && typeof data === "object" && "projects" in data) {
    const projects = (data as { projects?: Project[] }).projects;
    return (projects ?? []).map(normalizeProject).filter((p) => p._id);
  }
  return [];
}

export async function apiGetProject(id: string): Promise<Project | null> {
  const data = await apiFetch<Project>(`/api/projects/${encodeURIComponent(id)}`);
  return normalizeProject(data);
}

export async function apiCreateProject(payload: { name: string; description?: string }): Promise<Project> {
  const created = await apiFetch<Project>("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const normalized = normalizeProject(created);
  if (!normalized._id) throw new Error("API 응답에 프로젝트 ID가 없습니다.");
  return normalized;
}

export async function apiDeleteProject(id: string): Promise<void> {
  await apiFetch<void>(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function apiUpdateProject(
  id: string,
  payload: { name?: string; description?: string },
): Promise<Project> {
  const updated = await apiFetch<Project>(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return normalizeProject(updated);
}
