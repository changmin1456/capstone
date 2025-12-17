import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../components/Modal";
import { apiCreateProject, apiDeleteProject, apiGetProjects, type Project } from "../apis/projects";
import { apiLogout } from "../apis/auth";

export default function ProjectsPage() {
  const nav = useNavigate();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    void loadProjects();
  }, []);

  async function loadProjects() {
    setLoading(true);
    setError(null);
    setCreateError(null);
    try {
      const list = await apiGetProjects();
      setProjects(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!name.trim() || creating) return;

    const dup = projects.some(
      (p) => (p.name || "").trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (dup) {
      setCreateError("이미 같은 이름의 프로젝트가 있습니다.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const created = await apiCreateProject({ name: name.trim(), description: desc.trim() || undefined });
      setProjects((prev) => [created, ...prev]);
      setOpen(false);
      setName("");
      setDesc("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create project";
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id?: string) {
    if (!id || deletingId) return;
    setDeletingId(id);
    setError(null);
    try {
      await apiDeleteProject(id);
      setProjects((prev) => prev.filter((p) => p._id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete project");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="space-y-6 px-2 sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-sky-300 shadow-[0_0_12px_rgba(125,211,252,0.8)]" />
            <div className="text-3xl font-black tracking-tight text-white">Home</div>
          </div>
          <button
            type="button"
            onClick={() => {
              apiLogout();
              nav("/auth");
            }}
            className="h-10 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/10"
          >
            Logout
          </button>
        </div>
        <div className="h-px w-full bg-white/10" />

        <div className="flex items-center justify-between">
          <div className="text-xl font-extrabold tracking-tight text-white/90">My Projects</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          )}

          {loading ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-10 text-center text-white/60">
              불러오는 중...
            </div>
          ) : projects.length === 0 ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr">
              <button
                type="button"
                onClick={() => {
                  setCreateError(null);
                  setOpen(true);
                }}
                className="group relative overflow-hidden rounded-2xl border border-dashed border-blue-300/35 bg-white/[0.02] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)] transition hover:-translate-y-0.5 hover:border-blue-300/60 hover:bg-white/[0.04] min-h-[240px] text-left w-full"
              >
                <div className="relative flex h-full flex-col justify-between">
                  <div className="space-y-2">
                    <div className="text-xl font-bold text-white/90">+ New Project</div>
                    <div className="text-sm text-white/55">새 프로젝트를 생성하세요.</div>
                  </div>
                  <div className="text-sm font-semibold text-blue-300/90 transition group-hover:text-blue-200 text-right flex items-center justify-end gap-1">
                    <span>Create</span>
                    <span>→</span>
                  </div>
                </div>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr">
              {projects.map((p) => (
                <button
                  key={p._id}
                  type="button"
                  onClick={() => nav(`/projects/${p._id}`)}
                  className="text-left group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/8 via-white/[0.04] to-white/[0.02] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)] transition hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_28px_80px_rgba(0,0,0,0.55)] flex flex-col h-full min-h-[240px]"
                >
                  <div className="pointer-events-none absolute inset-0 opacity-80">
                    <div className="absolute -top-28 -left-24 h-72 w-72 rounded-full bg-blue-500/18 blur-3xl" />
                    <div className="absolute -top-32 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-white/8 blur-3xl" />
                  </div>
                  <div className="relative flex flex-1 flex-col">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(p._id);
                      }}
                      disabled={deletingId === p._id}
                      className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/30 text-base text-white/50 backdrop-blur transition hover:bg-black/50 hover:text-red-400 disabled:opacity-50"
                      aria-label="delete project"
                    >
                      &times;
                    </button>

                    <div className="space-y-2 pr-8">
                      <div className="text-2xl font-extrabold leading-tight text-white/95 truncate">
                        {p.name}
                      </div>
                      <div className="text-sm leading-snug text-white/55 line-clamp-2">
                        {p.description || "등록된 설명이 없습니다."}
                      </div>
                    </div>

                    <div className="mt-auto pt-4 flex items-center justify-between">
                      <div className="text-sm text-white/45">{(() => {
                        const date = p.updatedAt || p.createdAt;
                        return date ? date.split("T")[0] : "날짜 없음";
                      })()}</div>
                      <div className="text-sm font-bold text-blue-300/90 transition group-hover:text-blue-200 whitespace-nowrap">
                        Open →
                      </div>
                    </div>
                  </div>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setCreateError(null);
                  setOpen(true);
                }}
                  className="group relative overflow-hidden rounded-2xl border border-dashed border-blue-300/35 bg-white/[0.02] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)] transition hover:-translate-y-0.5 hover:border-blue-300/60 hover:bg-white/[0.04] min-h-[240px] text-left w-full"
              >
                <div className="relative flex h-full flex-col justify-between">
                  <div className="space-y-2">
                    <div className="text-xl font-bold text-white/90">+ New Project</div>
                    <div className="text-sm text-white/55">새 프로젝트를 생성하세요.</div>
                  </div>
                  <div className="text-sm font-semibold text-blue-300/90 transition group-hover:text-blue-200 text-right flex items-center justify-end gap-1">
                    <span>Create</span>
                    <span>→</span>
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={open}
        title="Create Project"
        centered
        hideCloseButton
        onClose={() => {
          if (creating) return;
          setCreateError(null);
          setOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={creating}
              className="h-11 rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white/80 hover:bg-white/10 transition disabled:opacity-40"
            >
              취소
            </button>
            <button
              type="button"
              disabled={creating || !name.trim()}
              onClick={handleCreate}
              className="h-11 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-[0_15px_35px_rgba(59,130,246,0.45)] transition hover:bg-blue-500 disabled:opacity-40"
            >
              {creating ? "생성 중..." : "생성"}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {createError && (
            <div className="rounded-xl border border-rose-400/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {createError}
            </div>
          )}
          <div>
            <div className="text-sm font-semibold text-white/80">프로젝트 이름</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full h-11 rounded-xl border border-white/10 bg-black/20 px-4 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              placeholder="예) 얼굴 인식 프로그램"
              disabled={creating}
            />
          </div>

          <div>
            <div className="text-sm font-semibold text-white/80">설명</div>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="mt-2 w-full min-h-[110px] rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              placeholder="프로젝트 설명"
              disabled={creating}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
