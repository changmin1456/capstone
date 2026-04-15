import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "../components/Modal";
import SettingsModal from "../components/SettingsModal";
import { apiCreateProject, apiDeleteProject, apiGetProjects, type Project } from "../apis/projects";
import { apiFetch } from "../apis/api";
import { apiLogout } from "../apis/auth";
import { getAuthEmail } from "../utils/auth";
import { useI18n } from "../i18n";

type JobSummary = {
  createdAt?: string;
  updatedAt?: string;
  created_at?: string;
  updated_at?: string;
};

export default function ProjectsPage() {
  const nav = useNavigate();
  const { t } = useI18n();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectDates, setProjectDates] = useState<Record<string, { created: string | null; lastRun: string | null }>>(
    {},
  );
  const userEmail = getAuthEmail();
  const userInitial = (userEmail || "U").trim().charAt(0).toUpperCase();

  useEffect(() => {
    void loadProjects();
  }, [t]);

  const formatDate = (raw?: string | number | null): string | null => {
    if (!raw) return null;
    let ts: number;
    if (typeof raw === "number") {
      ts = raw > 1e12 ? raw : raw * 1000;
    } else if (/^\d+$/.test(raw)) {
      const num = Number(raw);
      ts = num > 1e12 ? num : num * 1000;
    } else {
      ts = Date.parse(raw);
    }
    if (!Number.isFinite(ts)) return null;
    const d = new Date(ts);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const getLatestJobDate = (jobs: JobSummary[]): string | null => {
    let latestTs = -1;
    for (const job of jobs) {
      const raw = job.updatedAt || job.updated_at || job.createdAt || job.created_at;
      const ts = raw ? Date.parse(raw) : Number.NaN;
      if (Number.isFinite(ts) && ts > latestTs) latestTs = ts;
    }
    if (latestTs <= 0) return null;
    const d = new Date(latestTs);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const updateProjectDates = async (list: Project[]) => {
    const entries = await Promise.all(
      list.map(async (p) => {
        const id = p._id || p.id;
        if (!id) return null;
        let lastRun: string | null = null;
        const projectLastRun = formatDate(p.lastRunAt || p.last_run_at);
        try {
          if (!projectLastRun) {
            const data = await apiFetch<unknown>(`/api/jobs?project_id=${encodeURIComponent(id)}`);
            const jobs = Array.isArray(data)
              ? (data as JobSummary[])
              : data && typeof data === "object" && "jobs" in data
                ? (((data as { jobs?: JobSummary[] }).jobs ?? []) as JobSummary[])
                : [];
            lastRun = getLatestJobDate(jobs);
          } else {
            lastRun = projectLastRun;
          }
        } catch {
          lastRun = projectLastRun;
        }
        const created = formatDate(p.createdAt || p.created_at);
        return [id, { created, lastRun }] as const;
      }),
    );
    const next: Record<string, { created: string | null; lastRun: string | null }> = {};
    for (const entry of entries) {
      if (entry) next[entry[0]] = entry[1];
    }
    setProjectDates(next);
  };

  async function loadProjects() {
    setLoading(true);
    setError(null);
    setCreateError(null);
    try {
      const list = await apiGetProjects();
      setProjects(list);
      void updateProjectDates(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("projects.apiErrorHelp"));
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
      setCreateError(t("projects.duplicateName"));
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const created = await apiCreateProject({ name: name.trim(), description: desc.trim() || undefined });
      setProjects((prev) => {
        const next = [created, ...prev];
        void updateProjectDates(next);
        return next;
      });
      setOpen(false);
      setName("");
      setDesc("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("projects.apiErrorHelp");
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
      setProjects((prev) => {
        const next = prev.filter((p) => p._id !== id);
        void updateProjectDates(next);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("projects.apiErrorHelp"));
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
            <div className="text-3xl font-black tracking-tight text-white">{t("projects.home")}</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-[rgb(var(--color-border))] bg-[rgb(var(--c-white-05))] px-3 py-1.5 text-sm text-[rgb(var(--color-text)/0.8)] max-w-[320px]">
              <div className="h-8 w-8 rounded-full border border-[rgb(var(--color-border))] bg-[rgb(var(--c-white-10))] text-xs font-semibold text-[rgb(var(--color-text)/0.8)] flex items-center justify-center">
                {userInitial}
              </div>
              <span className="break-all">{userEmail || "user"}</span>
            </div>
            <button
              type="button"
              className="h-10 w-10 rounded-xl border border-[rgb(var(--color-border))] bg-[rgb(var(--c-white-05))] text-[rgb(var(--color-text)/0.7)] transition hover:border-[rgb(var(--color-text)/0.35)] hover:bg-[rgb(var(--c-white-10))]"
              aria-label="settings"
              title={t("projects.settings")}
              onClick={() => setSettingsOpen(true)}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 mx-auto" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm8 2.5a6.7 6.7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L15 2h-4l-.8 2.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7.3 7.3 0 0 0 0 2L2.4 13.5l2 3.4 2.4-1a7 7 0 0 0 1.7 1L11 22h4l.8-2.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                apiLogout();
                nav("/auth");
              }}
              className="h-10 rounded-xl border border-[rgb(var(--color-border))] bg-[rgb(var(--c-white-05))] px-4 text-sm font-semibold text-[rgb(var(--color-text)/0.8)] transition hover:border-[rgb(var(--color-text)/0.35)] hover:bg-[rgb(var(--c-white-10))]"
            >
              {t("projects.logout")}
            </button>
          </div>
        </div>
        <div className="h-px w-full bg-[rgb(var(--c-white-10))]" />

        <div className="flex items-center justify-between">
          <div className="text-xl font-extrabold tracking-tight text-[rgb(var(--color-text)/0.9)]">
            {t("projects.myProjects")}
          </div>
        </div>

        <div className="rounded-2xl border border-[rgb(var(--c-white-10))] bg-[rgb(var(--c-white-03))] p-4 sm:p-5 shadow-[0_20px_60px_rgb(var(--c-black)/0.35)]">

          {error && (
            <div
              className="mb-6 rounded-xl border border-[rgb(var(--c-red-500))] bg-[rgb(var(--c-red-500-10))] px-4 py-3 text-sm text-theme-text"
              style={{ marginBottom: "20px" }}
            >
              {error}
            </div>
          )}

          {loading ? (
            <div className="rounded-2xl border border-[rgb(var(--c-white-10))] bg-[rgb(var(--c-white-035))] p-10 text-center text-[rgb(var(--color-text)/0.6)]">
              {t("common.loading")}
            </div>
          ) : projects.length === 0 ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr">
              <button
                type="button"
                onClick={() => {
                  setCreateError(null);
                  setOpen(true);
                }}
                className="group relative overflow-hidden rounded-2xl border border-dashed border-[rgb(var(--c-blue-300-60))] bg-[rgb(var(--c-white-02))] p-6 shadow-[0_20px_60px_rgb(var(--c-black)/0.35)] transition hover:-translate-y-0.5 hover:border-[rgb(var(--c-blue-500))] hover:bg-[rgb(var(--c-white-04))] min-h-[240px] text-left w-full"
              >
                <div className="relative flex h-full flex-col justify-between">
                  <div className="space-y-2">
                    <div className="text-xl font-bold text-[rgb(var(--color-text)/0.9)]">
                      {t("projects.newProject")}
                    </div>
                    <div className="text-sm text-[rgb(var(--color-text)/0.55)]">
                      {t("projects.newProjectHelp")}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-[rgb(var(--c-blue-600))] transition group-hover:text-[rgb(var(--c-blue-500))] text-right flex items-center justify-end gap-1">
                    <span>{t("common.create")}</span>
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
                  className="text-left group relative overflow-hidden rounded-2xl border border-[rgb(var(--c-white-10))] bg-gradient-to-br from-[rgb(var(--c-white-08))] via-[rgb(var(--c-white-04))] to-[rgb(var(--c-white-02))] p-6 shadow-[0_20px_60px_rgb(var(--c-black)/0.45)] transition hover:-translate-y-0.5 hover:border-[rgb(var(--c-white-20))] hover:shadow-[0_28px_80px_rgb(var(--c-black)/0.55)] flex flex-col h-full min-h-[240px]"
                >
                  <div className="pointer-events-none absolute inset-0 opacity-80">
                    <div className="absolute -top-28 -left-24 h-72 w-72 rounded-full bg-[rgb(var(--c-blue-500-18))] blur-3xl" />
                    <div className="absolute -top-32 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-[rgb(var(--c-white-08))] blur-3xl" />
                  </div>
                  <div className="relative flex flex-1 flex-col">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(p._id);
                      }}
                      disabled={deletingId === p._id}
                      className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-[rgb(var(--c-black-30))] text-base text-[rgb(var(--c-white-50))] backdrop-blur transition hover:bg-[rgb(var(--c-black-50))] hover:text-[rgb(var(--c-red-400))] disabled:opacity-50"
                      aria-label={t("projects.deleteProject")}
                    >
                      &times;
                    </button>

                    <div className="space-y-2 pr-8">
                      <div className="text-xl font-bold text-[rgb(var(--color-text)/0.9)] truncate">
                        {p.name}
                      </div>
                      <div className="text-sm text-[rgb(var(--color-text)/0.55)] line-clamp-2">
                        {p.description || t("projects.noDescription")}
                      </div>
                    </div>

                    <div className="mt-auto pt-4 flex items-center justify-between">
                      <div className="text-sm text-[rgb(var(--color-text)/0.45)] space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[rgb(var(--color-text)/0.4)]">{t("projects.createdDate")}:</span>
                          <span>{projectDates[p._id || p.id || ""]?.created || t("common.noDate")}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[rgb(var(--color-text)/0.4)]">{t("projects.lastRunDate")}:</span>
                          <span>{projectDates[p._id || p.id || ""]?.lastRun || t("common.noDate")}</span>
                        </div>
                      </div>
                      <div className="text-sm font-bold text-[rgb(var(--c-blue-600))] transition group-hover:text-[rgb(var(--c-blue-500))] whitespace-nowrap">
                        {t("common.open")} →
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
                  className="group relative overflow-hidden rounded-2xl border border-dashed border-[rgb(var(--c-blue-300-60))] bg-[rgb(var(--c-white-02))] p-6 shadow-[0_20px_60px_rgb(var(--c-black)/0.35)] transition hover:-translate-y-0.5 hover:border-[rgb(var(--c-blue-500))] hover:bg-[rgb(var(--c-white-04))] min-h-[240px] text-left w-full"
              >
                <div className="relative flex h-full flex-col justify-between">
                <div className="space-y-2">
                  <div className="text-xl font-bold text-[rgb(var(--color-text)/0.9)]">{t("projects.newProject")}</div>
                  <div className="text-sm text-[rgb(var(--color-text)/0.55)]">{t("projects.newProjectHelp")}</div>
                </div>
                <div className="text-sm font-semibold text-[rgb(var(--c-blue-600))] transition group-hover:text-[rgb(var(--c-blue-500))] text-right flex items-center justify-end gap-1">
                  <span>{t("common.create")}</span>
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
        title={t("projects.createTitle")}
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
              className="h-11 rounded-xl border border-[rgb(var(--c-white-10))] bg-[rgb(var(--c-white-05))] px-5 text-sm font-semibold text-[rgb(var(--color-text)/0.8)] hover:bg-[rgb(var(--c-white-10))] transition disabled:opacity-40"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={creating || !name.trim()}
              onClick={handleCreate}
              className="h-11 rounded-xl bg-[rgb(var(--c-blue-600))] px-5 text-sm font-semibold text-[rgb(var(--c-white))] shadow-[0_15px_35px_rgb(var(--c-blue-500)/0.45)] transition hover:bg-[rgb(var(--c-blue-500))] disabled:opacity-40"
            >
              {creating ? t("common.loading") : t("common.create")}
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {createError && (
            <div className="rounded-xl border border-[rgb(var(--c-rose-400-50))] bg-[rgb(var(--c-rose-500-10))] px-4 py-3 text-sm text-theme-text">
              {createError}
            </div>
          )}
          <div>
            <div className="text-sm font-semibold text-[rgb(var(--color-text)/0.8)]">{t("projects.projectName")}</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full h-11 rounded-xl border border-[rgb(var(--c-white-10))] bg-[rgb(var(--c-black-20))] px-4 text-[rgb(var(--color-text)/0.85)] placeholder:text-[rgb(var(--color-text)/0.3)] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--c-blue-500)/0.4)]"
              placeholder={t("projects.projectNamePlaceholder")}
              disabled={creating}
            />
          </div>

          <div>
            <div className="text-sm font-semibold text-[rgb(var(--color-text)/0.8)]">{t("projects.description")}</div>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="mt-2 w-full min-h-[110px] rounded-xl border border-[rgb(var(--c-white-10))] bg-[rgb(var(--c-black-20))] px-4 py-3 text-[rgb(var(--color-text)/0.85)] placeholder:text-[rgb(var(--color-text)/0.3)] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--c-blue-500)/0.4)]"
              placeholder={t("projects.descriptionPlaceholder")}
              disabled={creating}
            />
          </div>
        </div>
      </Modal>
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onLogout={() => {
          apiLogout();
          nav("/auth");
        }}
      />
    </>
  );
}
