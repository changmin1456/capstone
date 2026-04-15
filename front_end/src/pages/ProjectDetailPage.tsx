import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ExperimentCard, { type Experiment } from "../components/ExperimentCard";
import { apiDeleteProject, apiGetProject, apiUpdateProject, type Project } from "../apis/projects";
import { API_BASE, apiFetch } from "../apis/api";
import TrainModal from "../components/TrainModal";
import ModelManagerModal from "../components/ModelManagerModal";
import JobDashboardModal from "../components/JobDashboardModal";
import ProjectModal from "../components/ProjectModal";
import SettingsModal from "../components/SettingsModal";
import { apiLogout } from "../apis/auth";
import { getAuthEmail } from "../utils/auth";
import { useI18n } from "../i18n";

type JobFromApi = {
  _id: string;
  name?: string;
  title?: string;
  model?: string;
  epochs?: number;
  status?: string;
  description?: string;
  project_id?: string;
  dataset_path?: string;
  createdAt?: string;
  updatedAt?: string;
  dataset_name?: string;
  hyperparams?: {
    model_name?: string;
    epochs?: number;
    [key: string]: unknown;
  };
};

const normalizeStatus = (raw?: string): Experiment["status"] => {
  const s = (raw || "").toString().toUpperCase();
  if (s === "RUNNING") return "RUNNING";
  if (s === "FAILED" || s === "FAIL") return "FAILED";
  if (s === "DONE" || s === "SUCCESS" || s === "COMPLETED") return "DONE";
  if (s === "PAUSED" || s === "STOPPED") return "PAUSED";
  if (s === "QUEUED" || s === "PENDING" || s === "STARTING") return "QUEUED";
  return "QUEUED";
};

export default function ProjectDetailPage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const { t } = useI18n();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);

  const [jobs, setJobs] = useState<Experiment[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const [openTrain, setOpenTrain] = useState(false);
  const [openModels, setOpenModels] = useState(false);
  const [openDashboard, setOpenDashboard] = useState(false);
  const [openProjectModal, setOpenProjectModal] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const userEmail = getAuthEmail();
  const userInitial = (userEmail || "U").trim().charAt(0).toUpperCase();
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
  const getJobDate = (job: JobFromApi): string | null => {
    const raw =
      (job as { updated_at?: string | number }).updated_at ||
      job.updatedAt ||
      (job as { created_at?: string | number }).created_at ||
      job.createdAt;
    return formatDate(raw);
  };

  // If route param isn't a real project id (e.g. old cached link / name), try to resolve it.
  useEffect(() => {
    const raw = projectId ? String(projectId).trim() : "";
    if (!raw) return;
    // If it looks like an ObjectId, keep going.
    if (/^[a-fA-F0-9]{24}$/.test(raw)) return;

    let cancelled = false;
    (async () => {
      try {
  const projects = await apiFetch<Array<{ id?: string; _id?: string; name?: string }>>("/api/projects");
        const match = projects.find((p) => (p.name || "").trim() === raw);
        const resolved = match?.id || match?._id;
        if (!cancelled && resolved && /^[a-fA-F0-9]{24}$/.test(resolved)) {
          navigate(`/projects/${resolved}`, { replace: true });
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, projectId]);

  const fetchJobs = useCallback(async (): Promise<JobFromApi[]> => {
  const endpoint = projectId ? `/api/projects/${projectId}/jobs` : `/api/jobs`;
  const data = await apiFetch<unknown>(endpoint);
    if (Array.isArray(data)) return data as JobFromApi[];
    if (data && typeof data === "object" && "jobs" in data) {
      const jobsArray = (data as { jobs?: JobFromApi[] }).jobs;
      return jobsArray ?? [];
    }
    return [];
  }, [projectId]);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const list = await fetchJobs();
      const mapped: Experiment[] = list.map((job) => {
        const hyper = (job as { hyperparams?: Record<string, unknown> }).hyperparams || {};
        const modelName =
          job.model ||
          (typeof hyper.model_name === "string" ? hyper.model_name : undefined) ||
          t("projects.unknownModel");
        const descriptionVal =
          job.description ||
          (typeof hyper.description === "string" ? (hyper.description as string) : undefined);
        const epochsVal =
          typeof job.epochs === "number" && Number.isFinite(job.epochs)
            ? job.epochs
            : typeof hyper.epochs === "number" && Number.isFinite(hyper.epochs)
              ? (hyper.epochs as number)
              : 0;
        const title =
          job.title ||
          job.name ||
          (typeof hyper.model_name === "string" ? hyper.model_name : undefined) ||
          job.dataset_name ||
          t("projects.untitledJob");
        return {
          id: job._id || (job as { id?: string }).id || "",
          status: normalizeStatus(job.status),
          rawStatus: job.status,
          title,
          model: modelName,
          description: descriptionVal,
          epochs: epochsVal,
          date: getJobDate(job) || t("common.noDate"),
          datasetName: job.dataset_name,
          datasetPath: (job as { dataset_path?: string }).dataset_path,
          projectId: (job as { project_id?: string }).project_id,
        };
      });

      mapped.sort((a, b) => {
        if (a.status === "RUNNING" && b.status !== "RUNNING") return -1;
        if (a.status !== "RUNNING" && b.status === "RUNNING") return 1;
        const ad = a.date === "—" ? "" : a.date;
        const bd = b.date === "—" ? "" : b.date;
        return bd.localeCompare(ad);
      });

      setJobs(mapped);
    } catch (e) {
      setJobs([]);
      setJobsError(e instanceof Error ? e.message : t("projects.loadJobsFailed"));
    } finally {
      setJobsLoading(false);
    }
  }, [fetchJobs, t]);

  const loadProject = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGetProject(projectId);
      setProject(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("projects.loadProjectFailed"));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const handleBack = useCallback(() => {
    navigate("/projects");
  }, [navigate]);

  const handleDetail = useCallback(() => {
    setOpenProjectModal(true);
  }, []);

  const handleSaveProject = useCallback(
    async (payload: { name: string; description?: string }) => {
      if (!projectId) return;
      const updated = await apiUpdateProject(projectId, payload);
      setProject(updated);
      setOpenProjectModal(false);
    },
    [projectId],
  );

  const handleDeleteProject = useCallback(async () => {
    if (!projectId || deletingProject) return;
    const ok = window.confirm(t("projects.deleteProjectConfirm"));
    if (!ok) return;
    setDeletingProject(true);
    try {
      await apiDeleteProject(projectId);
      navigate("/projects");
    } catch (e) {
      alert(e instanceof Error ? e.message : t("projects.deleteProjectFailed"));
      setDeletingProject(false);
    }
  }, [deletingProject, navigate, projectId, t]);

  const deleteJob = useCallback(
    async (jobId: string) => {
      if (!jobId) return;
      const ok = window.confirm(t("projects.deleteJobConfirm"));
      if (!ok) return;
      try {
  await apiFetch<void>(`/api/jobs/${jobId}?force=true`, { method: "DELETE" });
        void loadJobs();
      } catch (e) {
        alert(e instanceof Error ? e.message : t("projects.deleteJobFailed"));
      }
    },
    [loadJobs, t],
  );

  const openJobDashboard = useCallback((jobId: string) => {
    setSelectedJobId(jobId);
    setOpenDashboard(true);
  }, []);

  const updateJobEpochs = useCallback(
    async (jobId: string, epochs: number) => {
      try {
        await apiFetch<void>(`/api/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ epochs }),
        });
        void loadJobs();
    } catch (e) {
      alert(e instanceof Error ? e.message : t("projects.apiErrorHelp"));
    }
  },
    [loadJobs, t],
  );

  if (!projectId) return null;

  return (
    <>
      <div className="space-y-6 px-2 sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[rgb(var(--c-sky-300))] shadow-[0_0_12px_rgb(var(--c-sky-300)/0.8)]" />
            <div className="text-3xl font-black tracking-tight text-[rgb(var(--color-text))]">{t("train.title")}</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-[rgb(var(--color-border))] bg-[rgb(var(--c-white-05))] px-3 py-1.5 text-sm text-[rgb(var(--color-text)/0.8)] max-w-[320px]">
              <div className="h-8 w-8 rounded-full border border-[rgb(var(--color-border))] bg-[rgb(var(--c-white-10))] text-xs font-semibold text-[rgb(var(--color-text)/0.8)] flex items-center justify-center">
                {userInitial}
              </div>
              <span className="break-all">{userEmail || t("common.user")}</span>
            </div>
            <button
              type="button"
              className="h-10 w-10 rounded-xl border border-[rgb(var(--color-border))] bg-[rgb(var(--c-white-05))] text-[rgb(var(--color-text)/0.7)] transition hover:border-[rgb(var(--color-text)/0.35)] hover:bg-[rgb(var(--c-white-10))]"
              aria-label={t("projects.settings")}
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
                navigate("/auth");
              }}
              className="h-10 rounded-xl border border-[rgb(var(--color-border))] bg-[rgb(var(--c-white-05))] px-4 text-sm font-semibold text-[rgb(var(--color-text)/0.8)] transition hover:border-[rgb(var(--color-text)/0.35)] hover:bg-[rgb(var(--c-white-10))]"
            >
              {t("projects.logout")}
            </button>
          </div>
        </div>
        <div className="h-px w-full bg-[rgb(var(--c-white-10))]" />

  <div className="relative rounded-2xl border border-[rgb(var(--color-border))] bg-[rgb(var(--c-white-08))] p-6 space-y-6">
        <style>{`
          input[type="number"]::-webkit-inner-spin-button,
          input[type="number"]::-webkit-outer-spin-button {
            filter: invert(1);
          }
        `}</style>
  <div className="space-y-5">
          {/* Row 1: name (left) + close X (right) aligned on the top line */}
          <div className="flex items-start justify-between gap-3">
            <div className="text-[rgb(var(--color-text)/0.9)] text-2xl font-extrabold">
              {project?.name || t("projects.myProjects")}
            </div>
            <button
              type="button"
              onClick={handleBack}
              className="h-9 w-9 rounded-full border border-[rgb(var(--c-white-10))] bg-[rgb(var(--c-white-05))] text-[rgb(var(--color-text)/0.6)] hover:bg-[rgb(var(--c-white-10))] hover:text-[rgb(var(--color-text)/0.8)] transition"
              aria-label={t("common.close")}
            >
              ×
            </button>
          </div>

          {/* Row 2: left meta (description + projectId) and right actions aligned to the projectId line */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-0">
              <div className="text-[rgb(var(--color-text)/0.55)] text-sm">
                {project?.description || t("train.descriptionEmpty")}
              </div>
              <div className="text-[rgb(var(--color-text)/0.4)] text-xs">
                {t("train.projectId")}: <span className="font-mono">{projectId}</span>
              </div>
              {error && <div className="text-xs text-[rgb(var(--c-red-200))]">{error}</div>}
              {loading && <div className="text-xs text-[rgb(var(--color-text)/0.5)]">{t("common.loading")}</div>}
            </div>

            <div className="flex flex-wrap items-center gap-2 justify-end">
              <button
                type="button"
                onClick={handleDetail}
                className="h-10 rounded-xl border border-[rgb(var(--color-border))] bg-[rgb(var(--c-white-05))] px-4 text-sm font-semibold text-[rgb(var(--color-text)/0.8)] transition hover:border-[rgb(var(--color-text)/0.35)] hover:bg-[rgb(var(--c-white-10))]"
              >
                {t("train.detail")}
              </button>
              <button
                type="button"
                onClick={() => setOpenModels(true)}
                className="h-10 rounded-xl border border-[rgb(var(--color-border))] bg-[rgb(var(--c-white-05))] px-4 text-sm font-semibold text-[rgb(var(--color-text)/0.8)] transition hover:border-[rgb(var(--color-text)/0.35)] hover:bg-[rgb(var(--c-white-10))]"
              >
                {t("train.models")}
              </button>
              <button
                type="button"
                onClick={() => void loadJobs()}
                className="h-10 rounded-xl border border-[rgb(var(--color-border))] bg-[rgb(var(--c-white-05))] px-4 text-sm font-semibold text-[rgb(var(--color-text)/0.8)] transition hover:border-[rgb(var(--color-text)/0.35)] hover:bg-[rgb(var(--c-white-10))] disabled:opacity-50"
                disabled={jobsLoading}
              >
                {t("train.refresh")}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteProject()}
                className="h-10 rounded-xl border border-[rgb(var(--c-rose-400-50))] bg-[rgb(var(--c-rose-500-15))] px-4 text-sm font-semibold text-[rgb(var(--c-rose-500))] transition hover:border-[rgb(var(--c-rose-300-80))] hover:bg-[rgb(var(--c-rose-500-25))] disabled:opacity-50"
                disabled={deletingProject}
              >
                {t("train.delete")}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {jobsLoading && (
            <div className="rounded-2xl border border-[rgb(var(--c-white-10))] bg-[rgb(var(--c-white-035))] p-8 text-[rgb(var(--color-text)/0.6)]">
              {t("common.loading")}
            </div>
          )}

          {!jobsLoading && jobsError && (
            <div className="rounded-2xl border border-[rgb(var(--c-rose-500-25))] bg-[rgb(var(--c-rose-500-10))] p-6 text-[rgb(var(--c-rose-200))]">
              <div className="font-bold">{t("projects.apiError")}</div>
              <div className="mt-1 text-sm text-[rgb(var(--c-rose-200-80))]">{jobsError}</div>
              <div className="mt-3 text-sm text-[rgb(var(--c-rose-200-70))] whitespace-pre-line">
                {t("projects.apiErrorDetail", {
                  endpoint: projectId ? `/api/projects/${projectId}/jobs` : "/api/jobs",
                  apiBase: API_BASE,
                })}
              </div>
            </div>
          )}

          {!jobsLoading && !jobsError && jobs.length === 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr">
              <button
                type="button"
                onClick={() => setOpenTrain(true)}
                className="text-left group relative overflow-hidden rounded-2xl border border-dashed border-[rgb(var(--c-blue-300-35))] bg-[rgb(var(--c-white-02))] px-6 pt-4 pb-6 shadow-[0_20px_60px_rgb(var(--c-black)/0.35)] transition hover:-translate-y-0.5 hover:border-[rgb(var(--c-blue-300-60))] hover:bg-[rgb(var(--c-white-04))] min-h-[240px]"
                disabled={loading}
              >
                <div className="pointer-events-none absolute inset-0 opacity-60">
                  <div className="absolute inset-0 bg-gradient-to-br from-[rgb(var(--c-blue-900-20))] via-transparent to-[rgb(var(--c-black-30))]" />
                </div>
                <div className="relative flex h-full flex-col justify-between">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[rgb(var(--c-blue-200))]">
                    </div>
                    <div className="text-xl font-bold text-[rgb(var(--color-text)/0.9)]">{t("train.newTraining")}</div>
                    <div className="text-sm text-[rgb(var(--color-text)/0.55)]">{t("train.newTrainingHelp")}</div>
                  </div>
                  <div className="text-sm font-semibold text-[rgb(var(--c-blue-600))] text-right flex items-center justify-end gap-1">
                    <span>{t("common.create")}</span>
                    <span>→</span>
                  </div>
                </div>
              </button>
            </div>
          )}

          {!jobsLoading && !jobsError && jobs.length > 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr">
              {jobs.map((item) => (
                <ExperimentCard
                  key={item.id}
                  item={item}
                  onDelete={deleteJob}
                  onView={openJobDashboard}
                  onEpochChange={updateJobEpochs}
                />
              ))}
              <button
                type="button"
                onClick={() => setOpenTrain(true)}
                className="text-left group relative overflow-hidden rounded-2xl border border-dashed border-[rgb(var(--c-blue-300-35))] bg-[rgb(var(--c-white-02))] px-6 pt-4 pb-6 shadow-[0_20px_60px_rgb(var(--c-black)/0.35)] transition hover:-translate-y-0.5 hover:border-[rgb(var(--c-blue-300-60))] hover:bg-[rgb(var(--c-white-04))] min-h-[240px] w-full"
                disabled={loading}
              >
                <div className="pointer-events-none absolute inset-0 opacity-60">
                  <div className="absolute inset-0 bg-gradient-to-br from-[rgb(var(--c-blue-900-20))] via-transparent to-[rgb(var(--c-black-30))]" />
                </div>
                <div className="relative flex h-full flex-col justify-between">
                  <div className="space-y-2">
                    <div className="text-xl font-bold text-[rgb(var(--color-text)/0.9)]">{t("train.newTraining")}</div>
                    <div className="text-sm text-[rgb(var(--color-text)/0.55)]">{t("train.newTrainingHelp")}</div>
                  </div>
                  <div className="text-sm font-semibold text-[rgb(var(--c-blue-600))] text-right flex items-center justify-end gap-1">
                    <span>{t("common.create")}</span>
                    <span>→</span>
                  </div>
                </div>
              </button>
            </div>
          )}
        </div>
        </div>
      </div>

      <TrainModal
        open={openTrain}
        onClose={() => setOpenTrain(false)}
        projectId={projectId}
        requireProjectId
        existingTitles={jobs.map((j) => j.title)}
        onCreated={() => void loadJobs()}
      />
      <ModelManagerModal open={openModels} onClose={() => setOpenModels(false)} />
      <ProjectModal
        open={openProjectModal}
        project={project}
        onClose={() => setOpenProjectModal(false)}
        onSave={handleSaveProject}
      />
      <JobDashboardModal
        open={openDashboard}
        onClose={() => {
          setOpenDashboard(false);
          setSelectedJobId(null);
        }}
        jobId={selectedJobId || undefined}
        title={jobs.find((j) => j.id === selectedJobId)?.title}
        model={jobs.find((j) => j.id === selectedJobId)?.model}
        description={jobs.find((j) => j.id === selectedJobId)?.description}
        datasetName={jobs.find((j) => j.id === selectedJobId)?.datasetName}
        datasetPath={jobs.find((j) => j.id === selectedJobId)?.datasetPath}
        epochs={jobs.find((j) => j.id === selectedJobId)?.epochs}
        projectId={projectId}
        status={jobs.find((j) => j.id === selectedJobId)?.status}
        rawStatus={jobs.find((j) => j.id === selectedJobId)?.rawStatus}
        onUpdated={() => void loadJobs()}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onLogout={() => {
          apiLogout();
          navigate("/auth");
        }}
      />
    </>
  );
}
