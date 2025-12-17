import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ExperimentCard, { type Experiment } from "../components/ExperimentCard";
import { apiDeleteProject, apiGetProject, apiUpdateProject, type Project } from "../apis/projects";
import { API_BASE, apiFetch } from "../apis/api";
import TrainModal from "../components/TrainModal";
import ModelManagerModal from "../components/ModelManagerModal";
import JobDashboardModal from "../components/JobDashboardModal";
import ProjectModal from "../components/ProjectModal";

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

const toISODate = (job: JobFromApi): string => {
  const raw =
    (job as { updated_at?: string }).updated_at ||
    job.updatedAt ||
    (job as { created_at?: string }).created_at ||
    job.createdAt;
  if (!raw) return "";
  return raw.slice(0, 10);
};

export default function ProjectDetailPage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
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
          "Unknown Model";
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
          "Untitled Job";
        return {
          id: job._id || (job as { id?: string }).id || "",
          status: normalizeStatus(job.status),
          rawStatus: job.status,
          title,
          model: modelName,
          description: descriptionVal,
          epochs: epochsVal,
          date: toISODate(job) || "—",
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
      setJobsError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setJobsLoading(false);
    }
  }, [fetchJobs]);

  const loadProject = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGetProject(projectId);
      setProject(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

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
    const ok = window.confirm("이 프로젝트를 삭제할까요? 모든 학습 Job이 함께 사라질 수 있습니다.");
    if (!ok) return;
    setDeletingProject(true);
    try {
      await apiDeleteProject(projectId);
      navigate("/projects");
    } catch (e) {
      alert(e instanceof Error ? e.message : "프로젝트 삭제에 실패했습니다.");
      setDeletingProject(false);
    }
  }, [deletingProject, navigate, projectId]);

  const deleteJob = useCallback(
    async (jobId: string) => {
      if (!jobId) return;
      const ok = window.confirm("이 학습 Job을 삭제할까요?");
      if (!ok) return;
      try {
  await apiFetch<void>(`/api/jobs/${jobId}?force=true`, { method: "DELETE" });
        void loadJobs();
      } catch (e) {
        alert(e instanceof Error ? e.message : "삭제에 실패했습니다.");
      }
    },
    [loadJobs],
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
        alert(e instanceof Error ? e.message : "Epochs 업데이트에 실패했습니다.");
      }
    },
    [loadJobs],
  );

  if (!projectId) return null;

  return (
    <>
      <div className="space-y-6 px-2 sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-sky-300 shadow-[0_0_12px_rgba(125,211,252,0.8)]" />
            <div className="text-3xl font-black tracking-tight text-white">Train</div>
          </div>
          <button
            type="button"
            className="h-10 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/10"
          >
            Logout
          </button>
        </div>
        <div className="h-px w-full bg-white/10" />

  <div className="relative rounded-2xl border border-white/10 bg-white/[0.035] p-6 space-y-6">
        <style>{`
          input[type="number"]::-webkit-inner-spin-button,
          input[type="number"]::-webkit-outer-spin-button {
            filter: invert(1);
          }
        `}</style>
  <div className="space-y-5">
          {/* Row 1: name (left) + close X (right) aligned on the top line */}
          <div className="flex items-start justify-between gap-3">
            <div className="text-white/90 text-2xl font-extrabold">
              {project?.name || " Project"}
            </div>
            <button
              type="button"
              onClick={handleBack}
              className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/80 transition"
              aria-label="close"
            >
              ×
            </button>
          </div>

          {/* Row 2: left meta (description + projectId) and right actions aligned to the projectId line */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-0">
              <div className="text-white/55 text-sm">
                {project?.description || " 설명이 없습니다."}
              </div>
              <div className="text-white/40 text-xs">
                projectId: <span className="font-mono">{projectId}</span>
              </div>
              {error && <div className="text-xs text-red-200">{error}</div>}
              {loading && <div className="text-xs text-white/50">불러오는 중...</div>}
            </div>

            <div className="flex flex-wrap items-center gap-2 justify-end">
              <button
                type="button"
                onClick={handleDetail}
                className="h-10 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/10"
              >
                Detail
              </button>
              <button
                type="button"
                onClick={() => setOpenModels(true)}
                className="h-10 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/10"
              >
                Models
              </button>
              <button
                type="button"
                onClick={() => void loadJobs()}
                className="h-10 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/10 disabled:opacity-50"
                disabled={jobsLoading}
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteProject()}
                className="h-10 rounded-xl border border-rose-400/50 bg-rose-500/15 px-4 text-sm font-semibold text-rose-100 transition hover:border-rose-300/80 hover:bg-rose-500/25 disabled:opacity-50"
                disabled={deletingProject}
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {jobsLoading && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-8 text-white/60">
              불러오는 중...
            </div>
          )}

          {!jobsLoading && jobsError && (
            <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-6 text-rose-200">
              <div className="font-bold">API 에러</div>
              <div className="mt-1 text-sm text-rose-200/80">{jobsError}</div>
              <div className="mt-3 text-sm text-rose-200/70">
                노드 서버가 켜져있는지, 그리고{" "}
                <span className="font-semibold">
                  {projectId ? `/api/projects/${projectId}/jobs` : "/api/jobs"}
                </span>{" "}
                가 정상인지 확인해봐.
                <br />
                (API_BASE: <span className="font-mono">{API_BASE}</span>)
              </div>
            </div>
          )}

          {!jobsLoading && !jobsError && jobs.length === 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr">
              <button
                type="button"
                onClick={() => setOpenTrain(true)}
                className="text-left group relative overflow-hidden rounded-2xl border border-dashed border-blue-300/35 bg-white/[0.02] px-6 pt-4 pb-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)] transition hover:-translate-y-0.5 hover:border-blue-300/60 hover:bg-white/[0.04] min-h-[240px]"
                disabled={loading}
              >
                <div className="pointer-events-none absolute inset-0 opacity-60">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-transparent to-black/30" />
                </div>
                <div className="relative flex h-full flex-col justify-between">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-200">
                    </div>
                    <div className="text-xl font-bold text-white/90">+ New Training</div>
                    <div className="text-sm text-white/55">새 학습을 생성하세요.</div>
                  </div>
                  <div className="text-sm font-semibold text-blue-200 text-right flex items-center justify-end gap-1">
                    <span>Create</span>
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
                className="text-left group relative overflow-hidden rounded-2xl border border-dashed border-blue-300/35 bg-white/[0.02] px-6 pt-4 pb-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)] transition hover:-translate-y-0.5 hover:border-blue-300/60 hover:bg-white/[0.04] min-h-[240px] w-full"
                disabled={loading}
              >
                <div className="pointer-events-none absolute inset-0 opacity-60">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-transparent to-black/30" />
                </div>
                <div className="relative flex h-full flex-col justify-between">
                  <div className="space-y-2">
                    <div className="text-xl font-bold text-white/90">+ New Training</div>
                    <div className="text-sm text-white/55">새 학습을 생성하세요.</div>
                  </div>
                  <div className="text-sm font-semibold text-blue-200 text-right flex items-center justify-end gap-1">
                    <span>Create</span>
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
    </>
  );
}
