import Modal from "./Modal";
import { API_BASE } from "../apis/api";
import { getAuthToken } from "../utils/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import JobDetailModal from "./JobDetailModal";
import { readHttpErrorMessage } from "../utils/httpError";
import { createPathFromPoints } from "../utils/simpleChart";
import { useI18n } from "../i18n";
import { useToast } from "./ToastProvider";

type Props = {
  open: boolean;
  onClose: () => void;
  jobId?: string;
  title?: string;
  model?: string;
  description?: string;
  datasetName?: string;
  datasetPath?: string;
  epochs?: number;
  projectId?: string;
  status?: string;
  rawStatus?: string;
  onUpdated?: () => void;
  hyperparams?: Record<string, unknown>;
};

export default function JobDashboardModal({
  open,
  onClose,
  jobId,
  title,
  model,
  description,
  datasetName,
  datasetPath,
  epochs,
  projectId,
  status,
  rawStatus,
  onUpdated,
  hyperparams,
}: Props) {
  const { t } = useI18n();
  const [starting, setStarting] = useState(false);
  const [controlLoading, setControlLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [xaiModalOpen, setXaiModalOpen] = useState(false);
  const [deployStatus, setDeployStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [deployMessage, setDeployMessage] = useState<string | null>(null);
  type XaiSourceKey = "training_results" | "dataset_train" | "dataset_val";
  type XaiSource = { key: XaiSourceKey; label: string; available: boolean };
  type XaiImageItem = { id: string; label: string; url: string };
  type XaiPanels = {
    original?: { label: string; url: string; fallback?: string };
    heatmap?: { label: string; url: string };
    boxes?: { label: string; url: string };
    overlay?: { label: string; url: string };
  };
  const [xaiSources, setXaiSources] = useState<XaiSource[]>([]);
  const [xaiSourceKey, setXaiSourceKey] = useState<XaiSourceKey>("training_results");
  const [xaiImages, setXaiImages] = useState<XaiImageItem[]>([]);
  const [xaiSelected, setXaiSelected] = useState<XaiImageItem | null>(null);
  const [xaiPanels, setXaiPanels] = useState<XaiPanels | null>(null);
  const [xaiLoading, setXaiLoading] = useState(false);
  const [xaiError, setXaiError] = useState<string | null>(null);
  const [xaiCacheBust, setXaiCacheBust] = useState(0);
  const xaiReqSeqRef = useRef(0);
  const xaiAbortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sseUnavailableRef = useRef(false);
  const USE_SSE = false; // ChangeStream 미지원 환경에서는 폴링만 사용
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [jobStatus, setJobStatus] = useState<string | undefined>(rawStatus || status);
  const statusRef = useRef<string | undefined>(rawStatus || status);
  const [progressData, setProgressData] = useState<{
    trainLoss?: number[];
    valLoss?: number[];
    trainAcc?: number[];
    valAcc?: number[];
    map50?: number[];
    map50_95?: number[];
    precision?: number[];
    recall?: number[];
    logs?: string[];
  }>({});
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const [expandedChart, setExpandedChart] = useState<{ label: string; data?: number[] } | null>(null);
  const [expandedHover, setExpandedHover] = useState<{ x: number; y: number; val: number; idx: number } | null>(null);
  const [taskType, setTaskType] = useState<"detect" | "classify">("detect");
  const [viewRunMode, setViewRunMode] = useState<"fresh" | "resume" | null>(null);
  const runIdRef = useRef<string | null>(null);
  const freshStartPendingRef = useRef(false);
  const freshStartBaselineRunIdRef = useRef<string | null>(null);
  const resetAtRef = useRef<number | null>(null);
  const toastRef = useRef<{ jobId?: string; status?: string } | null>(null);
  const { addToast } = useToast();
  const authHeaders = (): Record<string, string> => {
    const token = getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
  const fetchAuthed = (url: string, options: RequestInit = {}) => {
    const headers: HeadersInit = { ...authHeaders(), ...(options.headers as HeadersInit | undefined) };
    return fetch(url, { ...options, headers });
  };
  const resetTransientUi = () => {
    setExpandedChart(null);
    setExpandedHover(null);
    setDeployModalOpen(false);
    setDeployStatus("idle");
    setDeployMessage(null);
    setDeploying(false);
    setXaiModalOpen(false);
    setXaiPanels(null);
    setShowDetailModal(false);
    setDetailModal({ open: false, loading: false });
  };

  useEffect(() => {
    if (!open) {
      resetTransientUi();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  type JobFullDetail = {
    job?: Record<string, unknown>;
    progress?: Record<string, unknown>[];
    search_space?: Record<string, unknown>;
  };
  const [historyRows, setHistoryRows] = useState<
    {
      id: number;
      hyper: string;
      epochs: number;
      score: number | null;
      status: string;
      date?: string;
      dbId?: string;
      trainingConfig?: Record<string, unknown>;
      searchSpace?: Record<string, unknown>;
    }[]
  >([]);
  const nextHistoryIdRef = useRef(1);
  const completionRecordedRef = useRef(false);
  const jobDetailRef = useRef<JobFullDetail>({
    job: {} as Record<string, unknown>,
    progress: [],
    search_space: {} as Record<string, unknown>,
  });
  const [detailModal, setDetailModal] = useState<{
    open: boolean;
    loading: boolean;
    error?: string;
    record?: Record<string, unknown>;
  }>({ open: false, loading: false });
  type BestHyper = { lr?: number; batch?: number; momentum?: number; epochs?: number };
  const [bestHyper, setBestHyper] = useState<BestHyper | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);

  const sanitizeClientMessage = useCallback((msg: string) => {
    if (!msg) return "";
    let s = String(msg);
    // remove obvious absolute paths
    s = s.replace(/\b\/[\w.\-]+(\/[\w.\-]+)+\b/g, "[path]");
    s = s.replace(/([A-Za-z]:\\[^\s]+)/g, "[path]");
    // clamp length
    if (s.length > 240) s = s.slice(0, 240) + "…";
    return s;
  }, []);

  const toNodeFileUrl = useCallback((url: string) => {
    // FastAPI returns `/files/...` but the frontend talks to Node under `/api/*`.
    // Node proxies static files at `/api/files/...`.
    if (!url) return url;
    const normalize = (u: string) => {
      // Encode each path segment, but keep slashes and existing query string.
      // This prevents broken <img> loads when file names include spaces/Korean.
      const [path, qs] = u.split("?");
      const encodedPath = path
        .split("/")
        .map((seg, idx) => {
          if (idx === 0) return seg; // leading empty segment for absolute paths
          return seg ? encodeURIComponent(decodeURIComponent(seg)) : seg;
        })
        .join("/");
      return qs ? `${encodedPath}?${qs}` : encodedPath;
    };

    if (url.startsWith("/api/files/")) return normalize(url);
    if (url.startsWith("/files/")) return normalize(`/api${url}`);
    return normalize(url);
  }, []);

  const withAuthToken = useCallback((url: string) => {
    if (!url) return url;
    const token = getAuthToken();
    if (!token) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}token=${encodeURIComponent(token)}`;
  }, []);

  const withCacheBust = useCallback((url: string, bust: number) => {
    if (!url) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}t=${bust}`;
  }, []);

  const fetchXaiSources = useCallback(async () => {
    if (!jobId) return;
    setXaiLoading(true);
    setXaiError(null);
    try {
      const res = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}/xai/sources`);
      const data = (await res.json()) as { sources?: XaiSource[]; error?: string };
      if (!res.ok) {
        throw new Error(data?.error || t("jobDashboard.failedToLoadSources"));
      }
      const sources = Array.isArray(data.sources) ? data.sources : [];
      setXaiSources(sources);
      const preferred = (sources.find((s) => s.key === xaiSourceKey && s.available) ||
        sources.find((s) => s.available) ||
        sources[0]) as XaiSource | undefined;
      if (preferred?.key) setXaiSourceKey(preferred.key);
    } catch (e) {
      setXaiError(sanitizeClientMessage((e as Error)?.message || t("jobDashboard.failedToLoadSources")));
    } finally {
      setXaiLoading(false);
    }
  }, [jobId, sanitizeClientMessage, t, xaiSourceKey]);

  const fetchXaiImages = useCallback(
    async (source: XaiSourceKey) => {
      if (!jobId) return;
      setXaiLoading(true);
      setXaiError(null);
      setXaiImages([]);
      setXaiSelected(null);
      setXaiPanels(null);
      try {
        const qs = new URLSearchParams({ source, limit: "60" });
        const res = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}/xai/images?${qs.toString()}`);
        const data = (await res.json()) as { items?: XaiImageItem[]; error?: string };
        if (!res.ok) {
          throw new Error(data?.error || t("jobDashboard.failedToLoadImages"));
        }
        const items = Array.isArray(data.items) ? data.items : [];
        setXaiImages(items);
      } catch (e) {
        setXaiError(sanitizeClientMessage((e as Error)?.message || t("jobDashboard.failedToLoadImages")));
      } finally {
        setXaiLoading(false);
      }
    },
    [jobId, sanitizeClientMessage, t],
  );

  const generateXai = useCallback(
    async (source: XaiSourceKey, image_id: string) => {
      if (!jobId) return;

      // cancel previous in-flight request (users often click quickly)
      if (xaiAbortRef.current) {
        try {
          xaiAbortRef.current.abort();
        } catch {
          // ignore
        }
      }
      const ac = new AbortController();
      xaiAbortRef.current = ac;
      const reqId = ++xaiReqSeqRef.current;
  const bust = Date.now();

      setXaiLoading(true);
      setXaiError(null);
      // clear panels immediately so UI shows progress for the new selection
      setXaiPanels(null);
  setXaiCacheBust(bust);
      try {
        const res = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}/xai/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source, image_id }),
          signal: ac.signal,
        });
        const data = (await res.json()) as { panels?: XaiPanels; error?: string };
        if (!res.ok) {
          throw new Error(data?.error || t("jobDashboard.failedToGenerateXai"));
        }
        // Only apply if this is the latest request
        if (reqId === xaiReqSeqRef.current) {
          setXaiPanels((data as any).panels || null);
        }
      } catch (e) {
        // Ignore abort errors (they happen on rapid re-click)
        if ((e as any)?.name === "AbortError") return;
        if ((e as any)?.message?.includes?.("aborted")) return;
        setXaiError(sanitizeClientMessage((e as Error)?.message || t("jobDashboard.failedToGenerateXai")));
      } finally {
        if (reqId === xaiReqSeqRef.current) {
          setXaiLoading(false);
        }
      }
    },
    [jobId, sanitizeClientMessage, t],
  );

  useEffect(() => {
    if (!xaiModalOpen) return;
    fetchXaiSources();
  }, [xaiModalOpen, fetchXaiSources]);

  useEffect(() => {
    if (!xaiModalOpen) return;
    fetchXaiImages(xaiSourceKey);
  }, [xaiModalOpen, xaiSourceKey, fetchXaiImages]);
  const handleSaveExperiment = async () => {
    // 최신 하이퍼파라미터를 가져오기 위해 직전 job detail을 갱신
    if (jobId) {
      try {
        const res = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}/full`);
        if (res.ok) {
          const data = (await res.json()) as JobFullDetail;
          jobDetailRef.current = data || ({} as JobFullDetail);
        }
      } catch {
        // ignore fetch error; fallback to 기존 값
      }
    }

    const hyperSrc =
      (jobDetailRef.current.job?.hyperparams as Record<string, unknown> | undefined) ||
      (hyperparams as Record<string, unknown> | undefined) ||
      ({} as Record<string, unknown>);
    const lrVal = typeof hyperSrc?.lr === "number" ? hyperSrc.lr : undefined;
    const batchVal = typeof hyperSrc?.batch_size === "number" ? hyperSrc.batch_size : undefined;
    const hyper = `lr0: ${lrVal ?? "—"}   batch: ${batchVal ?? "—"}`;
    const epochsUsed =
      progressData.trainLoss?.length ||
      progressData.valLoss?.length ||
      progressData.trainAcc?.length ||
      progressData.valAcc?.length ||
      epochs ||
      0;
    const scoreVal =
      taskType === "classify"
        ? (getLastVal(progressData.valAcc) ?? getLastVal(progressData.trainAcc))
        : getLastVal(progressData.map50);
    const statusVal = normalizeLocalStatus(jobStatus || status);

    const rawSearchSpace =
      (jobDetailRef.current.search_space as Record<string, unknown> | undefined) ||
      (jobDetailRef.current.job?.hyperparams as any)?.search_space ||
      (jobDetailRef.current.job as any)?.search_space;
    const searchSpacePayload =
      (!isEmptyObj(rawSearchSpace) && rawSearchSpace) ||
      buildSearchSpaceFromHyper(rawSearchSpace) ||
      (lrVal !== undefined || batchVal !== undefined
        ? {
            batch_min: batchVal,
            batch_max: batchVal,
            lr_min: lrVal,
            lr_max: lrVal,
          }
        : ({} as Record<string, unknown>));

    const newRow = {
      id: nextHistoryIdRef.current++,
      dbId: undefined as string | undefined,
      hyper,
      epochs: epochsUsed,
      score: scoreVal ?? null,
      status: statusVal,
      date: new Date().toISOString().slice(0, 10),
      trainingConfig: hyperSrc,
      searchSpace: searchSpacePayload,
    };
    const nextHistory = [...historyRows, newRow];

    const logsFromProgress =
      jobDetailRef.current.progress?.flatMap((p) => {
        const l = (p as any).logs;
        if (!l) return [];
        return Array.isArray(l) ? l : [l];
      }) ?? [];

    const precisionVal = getLastVal(progressData.precision);
    const recallVal = getLastVal(progressData.recall);
    const f1Val =
      typeof precisionVal === "number" && typeof recallVal === "number" && precisionVal + recallVal > 0
        ? (2 * precisionVal * recallVal) / (precisionVal + recallVal)
        : null;
    const record = {
      jobId,
      job_id: jobId,
      project_id: projectId,
      model,
      status: jobStatus,
      task: taskType,
      trainingConfig: hyperSrc,
      dataset: {
        name: datasetName,
        path: datasetPath,
        epochs,
      },
      metrics:
        taskType === "classify"
          ? {
              acc: getLastVal(progressData.valAcc) ?? getLastVal(progressData.trainAcc),
              precision: precisionVal,
              recall: recallVal,
              f1: f1Val,
            }
          : {
              map50: getLastVal(progressData.map50),
              map50_95: getLastVal(progressData.map50_95),
              precision: precisionVal,
              recall: recallVal,
            },
      history: nextHistory,
      searchSpace: searchSpacePayload,
      logs: serializeLogs(progressData.logs?.length ? progressData.logs : logsFromProgress),
      hyperband_logs: buildHyperbandLines(),
      timestamp: new Date().toISOString(),
    };
    let dbId: string | undefined;
    try {
      const res = await fetchAuthed(`${API_BASE}/api/experiments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(record),
      });
      if (res.ok) {
        const data = (await res.json()) as { id?: string };
        dbId = data?.id;

        // If history save succeeded, lock dataset changes for this job.
        if (jobId) {
          void fetchAuthed(`${API_BASE}/api/jobs/${jobId}/lock-dataset`, { method: "POST" })
            .then((r) => {
              if (!r.ok) {
                console.warn("lock-dataset failed", r.status);
              }
            })
            .catch((e) => console.warn("lock-dataset request error", e));
        }
      }
    } catch {
      // DB 저장 실패는 UI를 깨지 않도록 무시 (필요 시 에러 표시 가능)
    }
    nextHistory[nextHistory.length - 1].dbId = dbId;
    setHistoryRows(nextHistory);
  };

  const handleShowDetailRecord = async (dbId?: string) => {
    setDetailModal({ open: true, loading: true });
    const idToUse = dbId || jobId;
    if (!idToUse) {
      setDetailModal({ open: true, loading: false, error: t("jobDashboard.recordIdMissing") });
      return;
    }
    try {
      // 1) experiments에서 우선 조회
      let record: Record<string, unknown> | undefined;
      let res = await fetchAuthed(`${API_BASE}/api/experiments/${idToUse}`);
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        record = data;
      } else if (res.status === 404 && jobId) {
        const listRes = await fetchAuthed(`${API_BASE}/api/experiments?job_id=${jobId}`);
        if (listRes.ok) {
          const list = (await listRes.json()) as Record<string, unknown>[];
          record = list[0];
        }
      }

      // 2) job detail도 불러와서 부족한 필드 보완
      let jobDetail: { job?: Record<string, unknown>; progress?: Record<string, unknown>[] } | undefined;
      if (jobId) {
        try {
          const fullRes = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}/full`);
          if (fullRes.ok) {
            jobDetail = (await fullRes.json()) as typeof jobDetail;
            jobDetailRef.current = jobDetail || ({} as JobFullDetail);
          }
        } catch {
          // ignore
        }
      }

      const merged: Record<string, unknown> = {
        ...(record || {}),
      };
      const jobDoc = jobDetail?.job;
      const progressDocs = jobDetail?.progress;

      // model/status 우선 순위: experiments > job detail > 현재 상태/props
      if (!merged.model && jobDoc?.model) merged.model = jobDoc.model;
      if (!merged.status && jobDoc?.status) merged.status = jobDoc.status;
      if (!merged.status && jobStatus) merged.status = jobStatus;

      // hyperparams
      const jobHyper = (jobDoc as any)?.hyperparams as Record<string, unknown> | undefined;
      const hasTrainingConfig =
        merged.trainingConfig && (!isEmptyObj(merged.trainingConfig) || Array.isArray(merged.trainingConfig));
      if (!hasTrainingConfig || jobHyper) {
        merged.trainingConfig = {
          ...(merged.trainingConfig as Record<string, unknown> | undefined),
          ...(hyperparams || {}),
          ...(jobHyper || {}),
        };
      }
      if (!merged.trainingConfig || isEmptyObj(merged.trainingConfig)) {
        merged.trainingConfig =
          jobDetailRef.current.job?.hyperparams ||
          hyperparams ||
          {};
      }
      // search space
      const tcHasSearch = (merged.trainingConfig as any)?.search_space;
      const jobSearchSpace =
        (jobDoc as any)?.search_space ||
        tcHasSearch ||
        (jobHyper as any)?.search_space ||
        buildSearchSpaceFromHyper(jobHyper);
      const recordSearchSpace = (record as any)?.searchSpace;

      let searchSpaceMerged: Record<string, unknown> =
        (!isEmptyObj(jobSearchSpace) && (jobSearchSpace as Record<string, unknown>)) ||
        (!isEmptyObj(recordSearchSpace) && (recordSearchSpace as Record<string, unknown>)) ||
        ((jobDetailRef.current.job?.search_space as Record<string, unknown> | undefined) ?? {}) ||
        (buildSearchSpaceFromHyper(merged.trainingConfig as Record<string, unknown>) as Record<string, unknown> | undefined) ||
        {};

      // hyperparams 내부에 search_space가 있으면 분리
      if ((merged.trainingConfig as any)?.search_space) {
        const internalSpace = (merged.trainingConfig as any).search_space as Record<string, unknown>;
        if (isEmptyObj(searchSpaceMerged)) {
          searchSpaceMerged = internalSpace || {};
        }
        delete (merged.trainingConfig as any).search_space;
      }

      const tc = merged.trainingConfig as any;
      // lr, batch_size를 searchSpace로 이동
      if (tc?.batch_size !== undefined) {
        searchSpaceMerged.batch_size = searchSpaceMerged.batch_size ?? tc.batch_size;
        searchSpaceMerged.batch_min = searchSpaceMerged.batch_min ?? tc.batch_min ?? tc.batch_size;
        searchSpaceMerged.batch_max = searchSpaceMerged.batch_max ?? tc.batch_max ?? tc.batch_size;
        delete tc.batch_size;
        delete tc.batch_min;
        delete tc.batch_max;
      }
      if (tc?.lr !== undefined) {
        searchSpaceMerged.lr = searchSpaceMerged.lr ?? tc.lr;
        searchSpaceMerged.lr_min = searchSpaceMerged.lr_min ?? tc.lr_min ?? tc.lr;
        searchSpaceMerged.lr_max = searchSpaceMerged.lr_max ?? tc.lr_max ?? tc.lr;
        delete tc.lr;
        delete tc.lr_min;
        delete tc.lr_max;
      }
      if (tc?.momentum_min !== undefined && searchSpaceMerged.momentum_min === undefined) {
        searchSpaceMerged.momentum_min = tc.momentum_min;
        delete tc.momentum_min;
      }
      if (tc?.momentum_max !== undefined && searchSpaceMerged.momentum_max === undefined) {
        searchSpaceMerged.momentum_max = tc.momentum_max;
        delete tc.momentum_max;
      }

      (merged as any).searchSpace = orderSearchSpace(searchSpaceMerged);
      // hyperparams 내부에 dataset_path는 표시에서 제외
      if ((merged.trainingConfig as any)?.dataset_path) {
        delete (merged.trainingConfig as any).dataset_path;
      }

      const resolvedTaskRaw = (merged as any)?.task ?? (jobDoc as any)?.task ?? taskType;
      const resolvedTask = typeof resolvedTaskRaw === "string" ? resolvedTaskRaw.toLowerCase() : taskType;
      // metrics 보강: progress 마지막 값으로 채우기
      if (!merged.metrics || (resolvedTask === "classify" ? !(merged.metrics as any)?.acc : !(merged.metrics as any)?.map50)) {
        const lastProg = progressDocs?.length ? progressDocs[progressDocs.length - 1] : undefined;
        const map50 = lastProg ? (lastProg as any).map50 ?? (lastProg as any).val_accuracy ?? (lastProg as any).accuracy : undefined;
        const map5095 = lastProg ? (lastProg as any).map50_95 ?? (lastProg as any).train_accuracy : undefined;
        const precision = lastProg ? (lastProg as any).precision : undefined;
        const recall = lastProg ? (lastProg as any).recall : undefined;
        merged.metrics = {
          ...(merged.metrics as Record<string, unknown> | undefined),
          ...(resolvedTask === "classify"
            ? {
                acc:
                  (merged.metrics as any)?.acc ??
                  getLastVal(progressData.valAcc) ??
                  getLastVal(progressData.trainAcc),
                precision: (merged.metrics as any)?.precision ?? precision ?? getLastVal(progressData.precision),
                recall: (merged.metrics as any)?.recall ?? recall ?? getLastVal(progressData.recall),
              }
            : {
                map50: (merged.metrics as any)?.map50 ?? map50 ?? getLastVal(progressData.map50),
                map50_95: (merged.metrics as any)?.map50_95 ?? map5095 ?? getLastVal(progressData.map50_95),
                precision: (merged.metrics as any)?.precision ?? precision ?? getLastVal(progressData.precision),
                recall: (merged.metrics as any)?.recall ?? recall ?? getLastVal(progressData.recall),
              }),
        };
      }

      // 로그 보강: progressData.logs 또는 progressDocs의 logs
      if (!merged.logs || (Array.isArray(merged.logs) && merged.logs.length === 0)) {
        const fromProg =
          progressDocs?.flatMap((p) => {
            const l = (p as any).logs;
            if (!l) return [];
            return Array.isArray(l) ? l : [l];
          }) ?? [];
        merged.logs =
          (fromProg.length ? serializeLogs(fromProg) : undefined) ??
          serializeLogs(progressData.logs ?? []) ??
          [];
      }

      setDetailModal({ open: true, loading: false, record: merged });
    } catch (e) {
      setDetailModal({
        open: true,
        loading: false,
        error: e instanceof Error ? e.message : t("jobDashboard.failedToLoadRecord"),
      });
    }
  };

  const handleDeleteExperiment = async (rowId: number, dbId?: string) => {
    // 순서는 삭제 외에는 유지: id는 재사용/재정렬하지 않음
    if (!window.confirm(t("jobDashboard.deleteHistoryConfirm"))) return;
    if (dbId) {
      try {
        await fetchAuthed(`${API_BASE}/api/experiments/${dbId}`, { method: "DELETE" });
      } catch {
        // ignore network error, 어차피 로컬에서도 제거
      }
    }
    setHistoryRows((prev) => prev.filter((r) => r.id !== rowId));
    void fetchHistory();
  };

  const toNumberSeries = (val: unknown): number[] | undefined => {
    const numRegex = /^[+-]?(?:\d+\.?\d*|\d*\.?\d+)(?:e[+-]?\d+)?$/i;
    const parseOne = (v: unknown): number | undefined => {
      if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
      if (typeof v === "string") {
        const trimmed = v.trim();
        if (!trimmed || !numRegex.test(trimmed)) return undefined;
        const n = Number.parseFloat(trimmed);
        return Number.isFinite(n) ? n : undefined;
      }
      return undefined;
    };

    if (Array.isArray(val)) {
      const nums = val.map(parseOne).filter((v): v is number => v !== undefined && Number.isFinite(v));
      return nums.length ? nums : undefined;
    }

    const single = parseOne(val);
    return single === undefined ? undefined : [single];
  };

  const mergeSeries = (current: number[] | undefined, incoming?: number[]) => {
    if (incoming && incoming.length) {
      return incoming.slice(-200);
    }
    return current ? current.slice(-200) : [];
  };

  const shouldKeepLog = (line: string) => {
    const t = line.trim();
    if (!t) return false;
    const lower = t.toLowerCase();
    const hasEpoch = lower.includes("epoch") && /\d+\/\d+/.test(t);
    const hasStep = /\b\d+\/\d+\b/.test(t);
    const hasMetric = /loss|acc|map|precision|recall/i.test(t);
    const hasError = lower.includes("error") || lower.includes("exception") || lower.includes("fail");
    return hasEpoch || hasStep || hasMetric || hasError;
  };

  const stripAnsi = (line: string) => line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

  const normalizeLogs = (incoming?: string[]) =>
    (incoming || [])
      .map((l) => stripAnsi(String(l)))
      .filter(shouldKeepLog)
      .slice(-400);

  const serializeLogs = (incoming?: unknown[]) => {
    if (!Array.isArray(incoming)) return [];
    return incoming
      .map((entry) => {
        if (entry && typeof entry === "object") {
          const line = (entry as any).line ?? (entry as any).message;
          if (typeof line === "string") return stripAnsi(line);
        }
        return stripAnsi(String(entry));
      })
      .filter((line) => typeof line === "string" && line.length);
  };

  const mergeLogs = (current: string[] | undefined, incoming?: string[]) => {
    const filtered = normalizeLogs(incoming);
    if (filtered.length) return filtered;
    // incoming이 없으면 기존 로그 유지(일시정지/재개 시 사라지는 문제 방지)
    return (current || []).slice(-400);
  };

  const buildHyperbandLines = () => {
    const trainLoss = progressData.trainLoss || [];
    const valLoss = progressData.valLoss || [];
    const trainAcc = progressData.trainAcc || [];
    const valAcc = progressData.valAcc || [];
    const precision = progressData.precision || [];
    const recall = progressData.recall || [];
    const maxLen = Math.max(
      trainLoss.length,
      valLoss.length,
      trainAcc.length,
      valAcc.length,
      precision.length,
      recall.length,
    );
    if (maxLen === 0) return [];

    const fmt = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) ? formatVal(v) : "—");
    const hasAcc = trainAcc.length > 0 || valAcc.length > 0;
    const lines: string[] = [];
    for (let i = 0; i < maxLen; i += 1) {
      const base = `epoch ${i + 1} | train_loss ${fmt(trainLoss[i])} | val_loss ${fmt(valLoss[i])}`;
      if (taskType === "classify") {
        lines.push(`${base} | train_acc ${fmt(trainAcc[i])} | val_acc ${fmt(valAcc[i])}`);
      } else {
        lines.push(`${base} | precision ${fmt(precision[i])} | recall ${fmt(recall[i])}`);
      }
    }
    return lines;
  };

  const isEmptyObj = (v: unknown) =>
    !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as Record<string, unknown>).length === 0;

  const interpretError = (msg?: string) => {
    if (!msg) return null;
    const m = msg.toLowerCase();
    if (m.includes("data.yaml not found")) return t("jobDashboard.datasetMissingDataYaml");
    if (m.includes("file not found") || m.includes("no such file")) return t("jobDashboard.datasetFileMissing");
    if (m.includes("permission")) return t("jobDashboard.datasetPermission");
    return msg;
  };

  const orderSearchSpace = (space: Record<string, unknown>) => {
    const order = [
      "batch_size",
      "batch_min",
      "batch_max",
      "lr",
      "lr_min",
      "lr_max",
      "momentum_min",
      "momentum_max",
    ];
    const result: Record<string, unknown> = {};
    order.forEach((k) => {
      if (space[k] !== undefined) result[k] = space[k];
    });
    Object.keys(space).forEach((k) => {
      if (!(k in result)) result[k] = space[k];
    });
    return result;
  };

  const extractBestHyper = (rows: typeof historyRows): BestHyper | null => {
    const toNumber = (v: unknown) => (typeof v === "number" ? v : undefined);
    const doneRows = rows.filter((r) => (r.status || "").toLowerCase() === "done" && typeof r.score === "number");
    if (!doneRows.length) return null;
    const best = doneRows.reduce((a, b) => ((b.score as number) > (a.score as number) ? b : a));
    const cfg = best.trainingConfig || {};
    const search = best.searchSpace || (cfg as any).search_space || {};
    return {
      lr: toNumber(cfg.lr ?? search.lr ?? search.lr_min),
      batch: toNumber(cfg.batch_size ?? search.batch_size ?? search.batch_min),
      momentum: toNumber(search.momentum_min ?? search.momentum_max),
      epochs: toNumber((cfg as any).epochs ?? best.epochs),
    };
  };
  const buildSearchSpaceFromHyper = (hyper: unknown) => {
    if (!hyper || typeof hyper !== "object" || Array.isArray(hyper)) return undefined;
    const pick = (k: string) => {
      const v = (hyper as Record<string, unknown>)?.[k];
      return typeof v === "number" ? v : undefined;
    };
    const space = {
      batch_min: pick("batch_min") ?? pick("batchMin"),
      batch_max: pick("batch_max") ?? pick("batchMax"),
      lr_min: pick("lr_min") ?? pick("lrMin"),
      lr_max: pick("lr_max") ?? pick("lrMax"),
      momentum_min: pick("momentum_min") ?? pick("momentumMin") ?? pick("mom_min") ?? pick("momMin"),
      momentum_max: pick("momentum_max") ?? pick("momentumMax") ?? pick("mom_max") ?? pick("momMax"),
      image_size: pick("image_size") ?? pick("imgsz"),
    };
    return Object.values(space).some((v) => v !== undefined) ? space : undefined;
  };

  const fetchHistory = useCallback(async () => {
    if (!jobId) {
      setHistoryRows([]);
      return;
    }
    try {
      const res = await fetchAuthed(`${API_BASE}/api/experiments?job_id=${jobId}`);
  if (!res.ok) throw new Error(await readHttpErrorMessage(res));
      const data = (await res.json()) as Array<Record<string, unknown>>;
      const toDateKey = (d: any): number => {
        const raw = d?.timestamp ?? d?.created_at;
        const t = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
        return Number.isFinite(t) ? t : 0;
      };

      const sorted = (data || []).slice().sort((a: any, b: any) => {
        const ta = toDateKey(a);
        const tb = toDateKey(b);
        // older first (stable-ish Trial numbering)
        return ta - tb;
      });

      const rows =
        sorted
          ?.map((d, idx) => {
            const trainingConfig = (d as any)?.trainingConfig || (d as any)?.hyperparams || {};
            const searchSpace = (d as any)?.searchSpace || (trainingConfig as any)?.search_space || {};
            const task = typeof (d as any)?.task === "string" ? String((d as any).task).toLowerCase() : "";
            const score =
              task === "classify"
                ? (d as any)?.metrics?.acc ?? (d as any)?.metrics?.accuracy ?? (d as any)?.score
                : (d as any)?.metrics?.map50 ?? (d as any)?.score;
            const hyperStr = `lr0: ${((trainingConfig as any)?.lr ?? "—")}   batch: ${
              ((trainingConfig as any)?.batch_size ?? "—")
            }`;
            // NOTE: 이전에는 “빈 기록” 필터로 초기 trial(#1)까지 사라지는 경우가 있었음.
            // 여기서는 그대로 표시하고, 필요하면 백엔드/저장 로직에서 샘플을 막는다.
            return {
              // 항상 연속 번호로 렌더링
              id: idx + 1,
              dbId: typeof d.id === "string" ? d.id : undefined,
              hyper: hyperStr,
              epochs: (d.dataset as any)?.epochs ?? epochs ?? 0,
              score: score ?? null,
              status: String(d.status ?? "DONE"),
              date: (d as any)?.timestamp
                ? String((d as any).timestamp).slice(0, 10)
                : ((d as any)?.created_at ? String((d as any).created_at).slice(0, 10) : undefined),
              trainingConfig,
              searchSpace,
            };
          })
          ?? [];
      nextHistoryIdRef.current = rows.length + 1;
      setHistoryRows(rows);
    } catch {
      setHistoryRows([]);
    }
  }, [API_BASE, epochs, jobId]);

  const parseLogsToSeries = (logs: string[]) => {
    const trainLoss: number[] = [];
    const valLoss: number[] = [];
    const trainAcc: number[] = [];
    const valAcc: number[] = [];
    const num = "[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?";
    const pickFirst = (line: string, label: string): number | undefined => {
      const m = line.match(new RegExp(`${label}\\s+(${num})`, "i"));
      if (!m) return undefined;
      const v = Number.parseFloat(m[1]);
      return Number.isFinite(v) ? v : undefined;
    };

    logs.forEach((line) => {
      const clean = stripAnsi(line);
      const tl = pickFirst(clean, "train_loss");
      const vl = pickFirst(clean, "val_loss");
      const ta = pickFirst(clean, "train_acc");
      const va = pickFirst(clean, "val_acc");
      if (tl !== undefined) trainLoss.push(tl);
      if (vl !== undefined) valLoss.push(vl);
      if (ta !== undefined) trainAcc.push(ta);
      if (va !== undefined) valAcc.push(va);
    });
    return {
      trainLoss: trainLoss.length ? trainLoss : undefined,
      valLoss: valLoss.length ? valLoss : undefined,
      trainAcc: trainAcc.length ? trainAcc : undefined,
      valAcc: valAcc.length ? valAcc : undefined,
    };
  };

  const normalizeLogEntries = (
    logsVal: unknown,
    runId: string | null,
  ): string[] => {
    if (!Array.isArray(logsVal)) return [];
    const rows = logsVal
      .map((entry) => {
        if (entry && typeof entry === "object") {
          const line = (entry as any).line ?? (entry as any).message;
          const entryRunId = typeof (entry as any).run_id === "string" ? (entry as any).run_id : null;
          if (runId && entryRunId && entryRunId !== runId) return null;
          if (typeof line === "string") return line;
        }
        if (typeof entry === "string") return entry;
        return String(entry);
      })
      .filter((line): line is string => typeof line === "string" && line.length > 0);
    return rows;
  };

  const normalizeLocalStatus = (val?: string) => {
    const s = (val || "").toUpperCase();
    if (s === "RUNNING") return "RUNNING";
    if (s === "PAUSED" || s === "PAUSING") return "PAUSED";
    if (s === "STOPPED") return "STOPPED";
    if (s === "FAILED" || s === "ERROR" || s === "FAIL") return "FAILED";
    if (s === "DONE" || s === "SUCCESS" || s === "COMPLETED") return "DONE";
    if (s === "QUEUED" || s === "PENDING" || s === "STARTING") return "QUEUED";
    return "QUEUED";
  };

  const toMs = (raw?: string | number | null) => {
    if (!raw) return null;
    if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
    if (/^\d+$/.test(raw)) {
      const num = Number(raw);
      return num > 1e12 ? num : num * 1000;
    }
    const ts = Date.parse(raw);
    return Number.isFinite(ts) ? ts : null;
  };

  useEffect(() => {
    if (!open) return;
    setShowDetailModal(false);
    setDetailModal({ open: false, loading: false });
    setError(null);
    setProgressData({});
    sseUnavailableRef.current = false;
    setProgressPct(null);
    setErrorReason(null);
    const nextStatus = normalizeLocalStatus(rawStatus || status);
    setJobStatus(nextStatus);
    statusRef.current = nextStatus;
    completionRecordedRef.current = false;
    setViewRunMode(null);
  }, [open, title, description, model, status, rawStatus]);

  useEffect(() => {
    if (!open || !jobId) return;
    const fetchDetail = async () => {
      try {
        const res = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}/full`);
        if (!res.ok) return;
        const data = (await res.json()) as { job?: Record<string, unknown> };
        jobDetailRef.current = data || ({} as JobFullDetail);
        const task = (data.job as any)?.task;
        if (typeof task === "string") {
          const t = task.toLowerCase();
          if (t === "detect" || t === "classify") setTaskType(t);
        }
      } catch {
        // ignore
      }
    };
    void fetchDetail();
  }, [open, jobId, API_BASE]);

  useEffect(() => {
    statusRef.current = jobStatus;
  }, [jobStatus]);

  useEffect(() => {
    if (!open) return;
    if (jobStatus === "DONE" && !completionRecordedRef.current) {
  // DONE 시점에 “로컬 히스토리 자동 생성”을 하면
  // - 생성시 자동으로 하나 생김
  // - #1이 안 보이고 #2/#3만 보임(필터/재정렬과 충돌)
  // - 학습 끝나면 자동 생성
  // 같은 문제를 유발함.
  // 히스토리는 사용자가 Save를 눌렀을 때만 서버에 저장/표시하도록 단순화.
      completionRecordedRef.current = true;
    }
    if (jobStatus === "RUNNING") {
      completionRecordedRef.current = false;
    }
  }, [jobStatus, progressData.valAcc, progressData.trainLoss, progressData.valLoss, progressData.trainAcc, epochs, open]);

  useEffect(() => {
    if (!open || !jobId) return;
    const normalized = normalizeLocalStatus(jobStatus || status);
    const prev = toastRef.current;
    if (prev?.jobId === jobId && prev?.status === normalized) return;
    toastRef.current = { jobId, status: normalized };
    if (normalized !== "DONE" && normalized !== "FAILED") return;
    addToast({
      title: normalized === "DONE" ? t("jobDashboard.toastDone") : t("jobDashboard.toastFailed"),
      message: title || jobId,
      variant: normalized === "DONE" ? "success" : "error",
    });
  }, [addToast, jobId, jobStatus, open, status, t, title]);

  useEffect(() => {
    completionRecordedRef.current = false;
    void fetchHistory();
  }, [fetchHistory]);

  // Best hyperparams 계산 (DONE 중 score 최대)
  useEffect(() => {
    const best = extractBestHyper(historyRows);
    setBestHyper(best);
  }, [historyRows]);

  // 로그가 추가될 때마다 최신 항목이 보이도록 스크롤을 하단으로 이동
  useEffect(() => {
    if (!open) return;
    const el = logContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, progressData.logs?.length]);

  // 폴링으로 백엔드 상태 동기화
  useEffect(() => {
    if (!open || !jobId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        const prevStatus = statusRef.current;
        const next = normalizeLocalStatus((data as { status?: string }).status);
        if (!cancelled && next && next !== statusRef.current) {
          statusRef.current = next;
          setJobStatus(next);
          if (next === "RUNNING" && prevStatus !== "PAUSED") {
            setProgressData({});
            setProgressPct(0);
          }
          onUpdated?.();
        }
        const progressUrl = `${API_BASE}/api/jobs/${jobId}/progress`;
        let progData: unknown;
        try {
          const progRes = await fetchAuthed(progressUrl);
          if (!progRes.ok) {
            if (!cancelled) {
              setError(t("jobDashboard.progressFailed", { status: progRes.status }));
            }
            return;
          }
          progData = await progRes.json();
        } catch {
          // ignore polling errors
        }

        if (progData) {
          const prog = Array.isArray(progData) ? progData[0] : progData;
          const progStatus = normalizeLocalStatus((prog as { status?: string }).status);
          const runId = typeof (prog as any)?.run_id === "string" ? (prog as any).run_id : null;
          const progUpdatedAt = toMs((prog as any)?.updated_at);
          if (runId) runIdRef.current = runId;
          if ((prog as any)?.error_message) {
            setErrorReason(String((prog as any).error_message));
          } else if (progStatus !== "FAILED") {
            setErrorReason(null);
          }
          const history = (prog as { history?: Record<string, unknown> }).history || {};
          const metricsAll = Array.isArray((prog as any)?.metrics) ? (prog as any).metrics : [];
          const logsVal = (prog as { logs?: unknown }).logs;
          const hasLogs = Array.isArray(logsVal) ? logsVal.length > 0 : Boolean(logsVal);
          const metrics =
            runId
              ? metricsAll.filter((m: any) => (m?.run_id || "legacy") === runId)
              : metricsAll;
          const hasMetrics = metrics.length > 0;
          const hasHistory =
            Array.isArray((history as any).train_loss) && (history as any).train_loss.length > 0 ||
            Array.isArray((history as any).val_loss) && (history as any).val_loss.length > 0 ||
            Array.isArray((history as any).train_accuracy) && (history as any).train_accuracy.length > 0 ||
            Array.isArray((history as any).val_accuracy) && (history as any).val_accuracy.length > 0;
          const hasSeries =
            Array.isArray((prog as any).train_loss) && (prog as any).train_loss.length > 0 ||
            Array.isArray((prog as any).val_loss) && (prog as any).val_loss.length > 0 ||
            Array.isArray((prog as any).train_accuracy) && (prog as any).train_accuracy.length > 0 ||
            Array.isArray((prog as any).val_accuracy) && (prog as any).val_accuracy.length > 0;
          const hasProgress = typeof (prog as { progress?: unknown }).progress === "number" &&
            (prog as { progress: number }).progress > 0;
          const isEmptyProgress = !hasLogs && !hasMetrics && !hasHistory && !hasSeries && !hasProgress;
          if (resetAtRef.current && progUpdatedAt && progUpdatedAt < resetAtRef.current) {
            return;
          }
          if (viewRunMode === "fresh" && freshStartPendingRef.current) {
            const baseRunId = freshStartBaselineRunIdRef.current;
            const runIdChanged = Boolean(runId) && (!baseRunId || runId !== baseRunId);
            const allowWithoutRunId = !runId && !isEmptyProgress && progStatus !== "QUEUED";
            if (!runIdChanged && !allowWithoutRunId) {
              return;
            }
            freshStartPendingRef.current = false;
            resetAtRef.current = null;
          }

          if (progStatus === "QUEUED" && isEmptyProgress) {
            setProgressData({});
            setProgressPct(null);
            return;
          }

          if (progStatus === "PAUSED" && statusRef.current !== "PAUSED") {
            statusRef.current = "PAUSED";
            setJobStatus("PAUSED");
          }

          if (typeof (prog as { progress?: unknown }).progress === "number") {
            setProgressPct((prog as { progress: number }).progress);
          } else if (progStatus === "RUNNING") {
            setProgressPct((prev) => (prev === null ? 0 : prev));
          }

          const metricVals = (key: string) =>
            metrics
              .map((m: any) => (typeof m?.[key] === "number" ? m[key] : undefined))
              .filter((v: any): v is number => typeof v === "number" && Number.isFinite(v));
          const metricsTrainLoss = metricVals("train_loss");
          const metricsValLoss = metricVals("val_loss");
          const metricsTrainAcc = metricVals("train_acc");
          const metricsValAcc = metricVals("val_acc");
          const metricsMap50 = metricVals("map50");
          const metricsMap5095 = metricVals("map50_95");
          const metricsPrecision = metricVals("precision");
          const metricsRecall = metricVals("recall");

          const nextTrainLoss = toNumberSeries(
            history.train_loss ?? prog?.train_loss ?? metricsTrainLoss ?? (prog as { loss?: unknown }).loss,
          );
          const nextValLoss = toNumberSeries(history.val_loss ?? prog?.val_loss ?? metricsValLoss);
          const nextTrainAcc = toNumberSeries(
            history.train_accuracy ?? prog?.train_accuracy ?? metricsTrainAcc ?? (prog as { accuracy?: unknown }).accuracy,
          );
          const nextValAcc = toNumberSeries(history.val_accuracy ?? prog?.val_accuracy ?? metricsValAcc);
          let logs = normalizeLogEntries(logsVal, runId);
          const parsedFromLogs = parseLogsToSeries(logs);
          const trainLossSeries =
            (parsedFromLogs.trainLoss && parsedFromLogs.trainLoss.length) ? parsedFromLogs.trainLoss : nextTrainLoss;
          const valLossSeries =
            (parsedFromLogs.valLoss && parsedFromLogs.valLoss.length) ? parsedFromLogs.valLoss : nextValLoss;
          const trainAccSeries =
            (parsedFromLogs.trainAcc && parsedFromLogs.trainAcc.length) ? parsedFromLogs.trainAcc : nextTrainAcc;
          const valAccSeries =
            (parsedFromLogs.valAcc && parsedFromLogs.valAcc.length) ? parsedFromLogs.valAcc : nextValAcc;

          setProgressData((prev) => {
            return {
              trainLoss: mergeSeries(prev.trainLoss, trainLossSeries),
              valLoss: mergeSeries(prev.valLoss, valLossSeries),
              trainAcc: mergeSeries(prev.trainAcc, trainAccSeries),
              valAcc: mergeSeries(prev.valAcc, valAccSeries),
              map50: mergeSeries(prev.map50, metricsMap50),
              map50_95: mergeSeries(prev.map50_95, metricsMap5095),
              precision: mergeSeries(prev.precision, metricsPrecision),
              recall: mergeSeries(prev.recall, metricsRecall),
              logs: mergeLogs(prev.logs, logs),
            };
          });
          setError(null);
        }
      } catch {
        // ignore polling errors
      }
    };

    void poll();
    const id = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, jobId, onUpdated]);

  // SSE 스트림으로 실시간 업데이트 (지원되는 경우)
  useEffect(() => {
    if (!open || !jobId || sseUnavailableRef.current || !USE_SSE) return;
    let es: EventSource | null = null;
    // SSE는 ChangeStream을 지원하는 몽고에서만 동작. 400/ChangeStream 오류 시 폴백.
    try {
      es = new EventSource(`${API_BASE}/api/jobs/${jobId}/progress/stream`);
    } catch {
      return;
    }

    const handleProgressPayload = (payload: Record<string, unknown>) => {
      const nextTrainLoss = toNumberSeries(payload.train_loss ?? payload.loss);
      const nextTrainAcc = toNumberSeries(payload.train_accuracy ?? payload.accuracy);
      const nextValLoss = toNumberSeries(payload.val_loss);
      const nextValAcc = toNumberSeries(payload.val_accuracy);
      const statusVal = typeof payload.status === "string" ? payload.status : undefined;
      const parsedFromLogs = parseLogsToSeries(
        Array.isArray(payload.logs) ? payload.logs.map((l) => String(l)) : [],
      );
      const hasAnySeries =
        (nextTrainLoss && nextTrainLoss.length) ||
        (nextValLoss && nextValLoss.length) ||
        (nextTrainAcc && nextTrainAcc.length) ||
        (nextValAcc && nextValAcc.length) ||
        (parsedFromLogs.trainLoss && parsedFromLogs.trainLoss.length) ||
        (parsedFromLogs.valLoss && parsedFromLogs.valLoss.length) ||
        (parsedFromLogs.trainAcc && parsedFromLogs.trainAcc.length) ||
        (parsedFromLogs.valAcc && parsedFromLogs.valAcc.length);

      const trainLossSeries =
        (parsedFromLogs.trainLoss && parsedFromLogs.trainLoss.length) ? parsedFromLogs.trainLoss : nextTrainLoss;
      const valLossSeries =
        (parsedFromLogs.valLoss && parsedFromLogs.valLoss.length) ? parsedFromLogs.valLoss : nextValLoss;
      const trainAccSeries =
        (parsedFromLogs.trainAcc && parsedFromLogs.trainAcc.length) ? parsedFromLogs.trainAcc : nextTrainAcc;
      const valAccSeries =
        (parsedFromLogs.valAcc && parsedFromLogs.valAcc.length) ? parsedFromLogs.valAcc : nextValAcc;

      setProgressData((prev) => ({
        trainLoss: mergeSeries(prev.trainLoss, trainLossSeries),
        valLoss: mergeSeries(prev.valLoss, valLossSeries),
        trainAcc: mergeSeries(prev.trainAcc, trainAccSeries),
        valAcc: mergeSeries(prev.valAcc, valAccSeries),
        logs: hasAnySeries ? mergeLogs(prev.logs, undefined) : prev.logs ?? [],
      }));

      if (statusVal) {
        const next = normalizeLocalStatus(statusVal);
        if (next && next !== statusRef.current) {
          statusRef.current = next;
          setJobStatus(next);
          onUpdated?.();
        }
      }
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as Record<string, unknown>;
        const type = typeof data.type === "string" ? data.type : "progress";
        if (type === "progress") {
          handleProgressPayload(data);
        } else if (type === "snapshot" && data.job) {
          const job = data.job as { status?: string };
          if (job.status) {
            const next = normalizeLocalStatus(job.status);
            statusRef.current = next;
            setJobStatus(next);
          }
        } else if (type === "done") {
          const statusVal = typeof data.status === "string" ? data.status : undefined;
          if (statusVal) {
            const next = normalizeLocalStatus(statusVal);
            statusRef.current = next;
            setJobStatus(next);
          }
        } else if (type === "error" && typeof data.message === "string") {
          const msg = data.message;
          // Change Streams 미지원 환경에서는 SSE는 무시하고 폴링만 사용
          if (msg.toLowerCase().includes("changestream")) {
            sseUnavailableRef.current = true;
            es?.close();
            return;
          }
          setError((prev) => prev || msg);
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      es?.close();
    };

    return () => {
      es?.close();
    };
  }, [open, jobId, onUpdated]);

  const pauseMode: "pause" | "resume" = jobStatus === "PAUSED" ? "resume" : "pause";
  const canStart = ["QUEUED", "STOPPED", "FAILED", "DONE"].includes(jobStatus || "");
  const canStop = jobStatus === "RUNNING";
  const canPause = jobStatus === "RUNNING";
  const canResume = jobStatus === "PAUSED";
  const canReset = Boolean(jobId) && jobStatus !== "RUNNING";
  const canEdit = jobStatus === "QUEUED" || jobStatus === "DONE";

  const updateStatus = async (next: string) => {
    if (!jobId) return;
    try {
      await fetchAuthed(`${API_BASE}/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    } catch {
      // best-effort; UI 상태는 로컬에서 유지
    }
  };

  const handleStart = async () => {
    if (!jobId || !canStart) return;
    setStarting(true);
    setError(null);
    setProgressData({});
    setProgressPct(null);
    setViewRunMode("fresh");
    freshStartPendingRef.current = true;
    freshStartBaselineRunIdRef.current = runIdRef.current;
    resetAtRef.current = Date.now();
    runIdRef.current = null;
    try {
      const res = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}/start`, { method: "POST" });
      if (!res.ok) {
        throw new Error(await readHttpErrorMessage(res));
      }
      await updateStatus("running");
      onUpdated?.();
      setJobStatus("RUNNING");
      statusRef.current = "RUNNING";
      setProgressPct(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("jobDashboard.startFailed"));
    } finally {
      setStarting(false);
    }
  };

  const handlePause = async () => {
    if (!jobId || !canPause) return;
    setControlLoading(true);
    setError(null);
    try {
      const res = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}/pause`, { method: "POST" });
      if (!res.ok) {
  throw new Error(await readHttpErrorMessage(res));
      }
      setJobStatus("PAUSED");
      statusRef.current = "PAUSED";
      await updateStatus("paused"); // backend start 허용 상태 유지
      onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("jobDashboard.pauseFailed"));
    } finally {
      setControlLoading(false);
    }
  };

  const handleResume = async () => {
    if (!jobId || !canResume) return;
    setControlLoading(true);
    setError(null);
    setViewRunMode("resume");
    try {
      const res = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}/resume`, { method: "POST" });
      if (!res.ok) {
  throw new Error(await readHttpErrorMessage(res));
      }
      setJobStatus("RUNNING");
      statusRef.current = "RUNNING";
      await updateStatus("running");
      onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("jobDashboard.resumeFailed"));
    } finally {
      setControlLoading(false);
    }
  };

  const handleStop = async () => {
    if (!jobId || !canStop) return;
    setControlLoading(true);
    setError(null);
    try {
      const res = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}/stop`, { method: "POST" });
      if (!res.ok) {
  throw new Error(await readHttpErrorMessage(res));
      }
      setJobStatus("STOPPED");
      statusRef.current = "STOPPED";
      await updateStatus("stopped");
      onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("jobDashboard.stopFailed"));
    } finally {
      setControlLoading(false);
    }
  };

  const handleReset = async () => {
    if (!jobId || !canReset) return;
    setControlLoading(true);
    setError(null);
    resetAtRef.current = Date.now();
    runIdRef.current = null;
    freshStartBaselineRunIdRef.current = null;
    freshStartPendingRef.current = true;
    setViewRunMode("fresh");
    try {
      const res = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}/reset`, { method: "POST" });
      if (!res.ok) {
        throw new Error(await readHttpErrorMessage(res));
      }
      setJobStatus("QUEUED");
      statusRef.current = "QUEUED";
      await updateStatus("queued");
      setProgressData({});
      setProgressPct(null);
      setViewRunMode(null);
      onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("jobDashboard.resetFailed"));
    } finally {
      setControlLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!jobId) return;
    const ok = window.confirm(t("jobDashboard.deleteJobConfirm"));
    if (!ok) return;
    setDeleteLoading(true);
    setError(null);
    try {
      const res = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}?force=true`, { method: "DELETE" });
      if (!res.ok) {
  throw new Error(await readHttpErrorMessage(res));
      }
      onUpdated?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("jobDashboard.deleteJobFailed"));
    } finally {
      setDeleteLoading(false);
    }
  };

  const sanitizeDeployErrorMessage = (raw: unknown): string => {
    const s = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
    if (!s.trim()) return t("jobDashboard.processFailed");

    let out = s;

    // JSON 에러 문자열이면 error/detail/message만 추출
    try {
      const parsed = JSON.parse(out) as any;
      const picked =
        (parsed && typeof parsed.error === "string" && parsed.error) ||
        (parsed && typeof parsed.detail === "string" && parsed.detail) ||
        (parsed && typeof parsed.message === "string" && parsed.message) ||
        "";
      if (picked) out = picked;
    } catch {
      // ignore
    }

    // 흔한 노이즈 제거
    out = out.replace(/^Command failed:\s*/i, "");
    out = out.replace(/model_path not found:\s*/i, "");

    // 로컬 절대 경로(/Users/...) 제거
    out = out.replace(/\/Users\/[^\s"']+/g, "");
    // 프로젝트 상대 경로(back_end/...) 제거
    out = out.replace(/back_end\/[\w\-./]+/g, "");

    // 공백 정리
    out = out.replace(/\s{2,}/g, " ").trim();
    return out || t("jobDashboard.processFailed");
  };

  const handleDeploy = async () => {
    if (!jobId) return;
    setDeploying(true);
    setDeployStatus("loading");
    setDeployMessage(null);
    try {
  const qs = new URLSearchParams();
  if (deployTarget) qs.set("target", deployTarget);
  if (deployOutputName.trim()) qs.set("output_name", deployOutputName.trim());
  const res = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}/deploy?${qs.toString()}`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = (data as { detail?: unknown } | null)?.detail;
        throw new Error(
          typeof detail === "string" ? detail : `${t("jobDashboard.deployRequestFailed")} (${res.status})`,
        );
      }
      const msg = ((data as any)?.deploy?.message as string | undefined) || t("jobDashboard.deploySuccess");

      // 우선 요청 접수 메시지 표시
  setDeployMessage(sanitizeDeployErrorMessage(msg));
      setDeployStatus("success");

      // 변환 완료/실패 상태를 폴링해서 UI에 반영
      // (Node 서버가 /api/jobs/:id 를 제공하므로 그걸 사용)
      const timeoutMs = 60_000;
      const intervalMs = 1500;
      const startedAt = Date.now();

      const pollOnce = async (): Promise<{
        status?: string;
        message?: string;
        outputPath?: string;
      } | null> => {
        try {
          const jres = await fetchAuthed(`${API_BASE}/api/jobs/${jobId}`);
          if (!jres.ok) return null;
          const j = (await jres.json().catch(() => null)) as any;
          const deploy = j?.deploy;
          if (!deploy || typeof deploy !== "object") return null;
          const st = (deploy.status || "").toString().toLowerCase();
          return {
            status: st,
            message: typeof deploy.message === "string" ? deploy.message : undefined,
            outputPath:
              typeof deploy.output_path === "string"
                ? deploy.output_path
                : typeof deploy.outputPath === "string"
                  ? deploy.outputPath
                  : undefined,
          };
        } catch {
          return null;
        }
      };

      const pollLoop = async () => {
        while (true) {
          if (Date.now() - startedAt > timeoutMs) {
            setDeployMessage((prev) => prev || t("jobDashboard.deployInProgressTimeout"));
            return;
          }
          // 모달이 닫혔거나 jobId가 사라지면 중단
          if (!jobId) return;

          const info = await pollOnce();
          const st = info?.status;

          if (st === "completed") {
            setDeployMessage(sanitizeDeployErrorMessage(info?.message || t("jobDashboard.deployCompleted")));
            setDeployStatus("success");
            return;
          }
          if (st === "failed") {
            setDeployMessage(sanitizeDeployErrorMessage(info?.message || t("jobDashboard.deployFailedMessage")));
            setDeployStatus("error");
            return;
          }

          await new Promise((r) => setTimeout(r, intervalMs));
        }
      };

      void pollLoop();
    } catch (e) {
      setDeployMessage(
        sanitizeDeployErrorMessage(e instanceof Error ? e.message : t("jobDashboard.deployRequestFailed")),
      );
      setDeployStatus("error");
    } finally {
      setDeploying(false);
    }
  };

  const handleOpenConvertedFolder = async () => {
    // 브라우저에서 로컬 폴더를 직접 여는 건 불가하므로,
    // 개발 환경에서는 node_server의 /api/terminal 라우트를 이용해 Finder(open) 실행.
    // (배포 환경에서는 별도 전용 API를 두는 걸 권장)
    if (!jobId) return;
    try {
  const cmd = `open /Users/changmin/Projects/capston/back_end/saved_models/deploy`;
      const res = await fetchAuthed(`${API_BASE}/api/terminal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cmd }),
      });
      if (!res.ok) {
      setDeployMessage(
        t("jobDashboard.openFolderFailed", { reason: sanitizeDeployErrorMessage(await readHttpErrorMessage(res)) }),
      );
        setDeployStatus("error");
        return;
      }
      setDeployMessage(t("jobDashboard.openFolderSuccess"));
      setDeployStatus("idle");
    } catch {
      setDeployMessage(t("jobDashboard.openFolderError"));
      setDeployStatus("error");
    }
  };

  // Deploy options (acts like a lightweight “save dialog”)
  const [deployTarget, setDeployTarget] = useState<"onnx" | "tensorrt">("onnx");
  const [deployOutputName, setDeployOutputName] = useState<string>(jobId || "");

  useEffect(() => {
    // When switching jobs, keep a sensible default.
    setDeployOutputName(jobId || "");
  }, [jobId]);

  const formatVal = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 100) return v.toFixed(0);
    if (abs >= 10) return v.toFixed(1);
    if (abs >= 1) return v.toFixed(2);
    return v.toFixed(4);
  };

  const renderChart = (_label: string, data: number[] | undefined) => {
    if (!data || data.length === 0) {
      return (
        <div className="h-[160px] rounded-lg border border-white/5 bg-black/30 flex items-center justify-center text-xs text-white/35">
          {t("common.noData")}
        </div>
      );
    }
    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);
  // const lastVal = data[data.length - 1];
    const w = 260;
    const h = 120;
    const pad = 14;
    const path = createPathFromPoints(data, w, h, pad);
    const svgContent =
      data.length === 1 ? (
        (() => {
          const [xStr, yStr] = path.split(",");
          const x = Number.parseFloat(xStr) || w / 2;
          const y = Number.parseFloat(yStr) || h / 2;
          return <circle cx={x} cy={y} r={4} fill="#60a5fa" />;
        })()
      ) : (
        <polyline points={path} fill="none" stroke="#60a5fa" strokeWidth="2" />
      );

    const mapY = (v: number) => {
      const rng = Math.max(maxVal - minVal, 1e-9);
      const sy = (h - pad * 2) / rng;
      return h - pad - (v - minVal) * sy;
    };
    const mapXTicks = (tickIdx: number) => {
      const denom = Math.max(xTicks.length - 1, 1);
      const sx = (w - pad * 2) / denom;
      return pad + tickIdx * sx;
    };

    const yTicks = [maxVal, (maxVal + minVal) / 2, minVal];
    // x-axis ticks: 1, 5, 10, 15... (labels are 1-based)
    const xStep = 5;
    const xTicks = (() => {
      const last = data.length - 1;
      if (last <= 0) return [0];
      const ticks: number[] = [0];
      for (let epoch = xStep; epoch <= data.length; epoch += xStep) {
        const idx = epoch - 1;
        if (!ticks.includes(idx)) ticks.push(idx);
      }
      if (ticks[ticks.length - 1] !== last) ticks.push(last);
      return ticks;
    })();

    return (
      <div className="h-[160px] rounded-lg border border-white/5 bg-black/30 p-2 flex flex-col">
        <div className="flex-1">
          <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
            {/* axes */}
            <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="rgb(var(--theme-chart-grid) / 0.18)" strokeWidth="1" />
            <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="rgb(var(--theme-chart-grid) / 0.18)" strokeWidth="1" />
            {yTicks.map((v, idx) => (
              <g key={`y-${idx}`}>
                <line
                  x1={pad - 4}
                  x2={pad}
                  y1={mapY(v)}
                  y2={mapY(v)}
                  stroke="rgb(var(--theme-chart-grid) / 0.35)"
                  strokeWidth="1"
                />
                <text
                  x={pad - 6}
                  y={mapY(v) + 3}
                  fontSize="9"
                  fill="rgb(var(--theme-chart-text) / 0.7)"
                  textAnchor="end"
                >
                  {formatVal(v)}
                </text>
              </g>
            ))}
    {xTicks.map((i, idx) => (
              <g key={`x-${idx}`}>
                <line
      x1={mapXTicks(idx)}
      x2={mapXTicks(idx)}
                  y1={h - pad}
                  y2={h - pad + 4}
                  stroke="rgb(var(--theme-chart-grid) / 0.35)"
                  strokeWidth="1"
                />
                <text
      x={mapXTicks(idx)}
                  y={h - pad + 12}
                  fontSize="9"
                  fill="rgb(var(--theme-chart-text) / 0.7)"
                  textAnchor="middle"
                >
                  {i + 1}
                </text>
              </g>
            ))}
            {svgContent}
          </svg>
        </div>
      </div>
    );
  };

  const getLastVal = (arr?: number[]) => (arr && arr.length ? arr[arr.length - 1] : null);

  const renderExpandedChart = (label: string, data?: number[]) => {
    if (!data || !data.length) {
      return <div className="text-white/50 text-sm">{t("common.noData")}</div>;
    }
    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);
    const w = 680;
    const h = 340;
    const pad = 28;
    const path = createPathFromPoints(data, w, h, pad);
    const svgContent =
      data.length === 1 ? (
        (() => {
          const [xStr, yStr] = path.split(",");
          const x = Number.parseFloat(xStr) || w / 2;
          const y = Number.parseFloat(yStr) || h / 2;
          return <circle cx={x} cy={y} r={6} fill="#3b82f6" />;
        })()
      ) : (
        <polyline points={path} fill="none" stroke="#3b82f6" strokeWidth="3" />
      );
    const mapY = (v: number) => {
      const rng = Math.max(maxVal - minVal, 1e-9);
      const sy = (h - pad * 2) / rng;
      return h - pad - (v - minVal) * sy;
    };
    const mapX = (i: number) => {
      const rng = Math.max(data.length - 1, 1);
      const sx = (w - pad * 2) / rng;
      return pad + i * sx;
    };
    const yTickCount = 5;
    const yTicks = Array.from({ length: yTickCount }, (_, i) => {
      const t = i / (yTickCount - 1);
      return maxVal - (maxVal - minVal) * t;
    });
    // x-axis ticks: 1, 5, 10, 15... (labels are 1-based)
    const xStep = 5;
    const xTicks = (() => {
      const last = data.length - 1;
      if (last <= 0) return [0];
      const ticks: number[] = [0];
      for (let epoch = xStep; epoch <= data.length; epoch += xStep) {
        const idx = epoch - 1;
        if (!ticks.includes(idx)) ticks.push(idx);
      }
      if (ticks[ticks.length - 1] !== last) ticks.push(last);
      return ticks;
    })();
    const mapXTicks = (tickIdx: number) => {
      const denom = Math.max(xTicks.length - 1, 1);
      const sx = (w - pad * 2) / denom;
      return pad + tickIdx * sx;
    };
    return (
      <div className="rounded-2xl border border-white/10 bg-[rgb(var(--theme-panel-strong))] px-6 py-5 shadow-2xl w-[760px] max-w-[96vw]">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold tracking-[0.14em] text-white/70">{label.toUpperCase()}</div>
          <button
            type="button"
            onClick={() => setExpandedChart(null)}
            className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
          >
            ×
          </button>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[360px] overflow-visible">
          <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="rgb(var(--theme-chart-grid) / 0.18)" strokeWidth="1" />
          <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="rgb(var(--theme-chart-grid) / 0.18)" strokeWidth="1" />
          {yTicks.map((v, idx) => (
            <g key={`exp-y-${idx}`}>
              <line x1={pad - 6} x2={pad} y1={mapY(v)} y2={mapY(v)} stroke="rgb(var(--theme-chart-grid) / 0.35)" />
              <text x={pad - 12} y={mapY(v) + 5} fontSize="12" fill="rgb(var(--theme-chart-text) / 0.8)" textAnchor="end">
                {formatVal(v)}
              </text>
            </g>
          ))}
          {xTicks.map((i, idx) => (
            <g key={`exp-x-${idx}`}>
              <line x1={mapXTicks(idx)} x2={mapXTicks(idx)} y1={h - pad} y2={h - pad + 6} stroke="rgb(var(--theme-chart-grid) / 0.35)" />
              <text x={mapXTicks(idx)} y={h - pad + 18} fontSize="12" fill="rgb(var(--theme-chart-text) / 0.8)" textAnchor="middle">
                {i + 1}
              </text>
            </g>
          ))}
          {svgContent}
          {data.map((v, idx) => {
            const cx = mapX(idx);
            const cy = mapY(v);
            return (
              <g key={`pt-${idx}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={3}
                  fill="#0c1020"
                  stroke="#3b82f6"
                  strokeWidth={1.5}
                  onMouseEnter={() => setExpandedHover({ x: cx, y: cy, val: v, idx })}
                  onMouseLeave={() => setExpandedHover(null)}
                />
              </g>
            );
          })}
          {expandedHover && (
            <g transform={`translate(${expandedHover.x},${expandedHover.y - 16})`}>
              <rect
                x={-36}
                y={-20}
                width={72}
                height={20}
                rx={7}
                ry={7}
                fill="rgba(17,24,39,0.92)"
                stroke="#3b82f6"
                strokeWidth={1.1}
              />
              <text x={0} y={-10} fill="#3b82f6" fontSize="12" textAnchor="middle" dominantBaseline="middle">
                {`${expandedHover.idx + 1} : ${formatVal(expandedHover.val)}`}
              </text>
            </g>
          )}
        </svg>
      </div>
    );
  };
  const lastPrecision = getLastVal(progressData.precision);
  const lastRecall = getLastVal(progressData.recall);
  const lastAcc = getLastVal(progressData.valAcc) ?? getLastVal(progressData.trainAcc);
  const f1Score =
    typeof lastPrecision === "number" && typeof lastRecall === "number" && lastPrecision + lastRecall > 0
      ? (2 * lastPrecision * lastRecall) / (lastPrecision + lastRecall)
      : null;
  const metricCards =
    taskType === "classify"
      ? [
          { label: t("jobDashboard.metrics.acc"), value: lastAcc },
          { label: t("jobDashboard.metrics.precision"), value: lastPrecision },
          { label: t("jobDashboard.metrics.recall"), value: lastRecall },
          { label: t("jobDashboard.metrics.f1"), value: f1Score },
        ]
      : [
          { label: t("jobDashboard.metrics.map50"), value: getLastVal(progressData.map50) },
          { label: t("jobDashboard.metrics.map95"), value: getLastVal(progressData.map50_95) },
          { label: t("jobDashboard.metrics.precision"), value: lastPrecision },
          { label: t("jobDashboard.metrics.recall"), value: lastRecall },
        ];
  const bestParams = [
    { label: "lr0", value: bestHyper?.lr ?? "—" },
    { label: "batch", value: bestHyper?.batch ?? "—" },
    { label: "momentum", value: bestHyper?.momentum ?? "—" },
    { label: "epochs", value: bestHyper?.epochs ?? "—" },
  ];
  const statusColors: Record<string, string> = {
    DONE: "text-emerald-300",
    RUNNING: "text-sky-300",
    FAILED: "text-rose-300",
    QUEUED: "text-emerald-300",
    PAUSED: "text-amber-200",
    STOPPED: "text-amber-200",
  };
  const statusText = normalizeLocalStatus(jobStatus || status);
  const formatStatusLabel = (value?: string) => {
    const s = (value || "").toUpperCase();
    if (s === "RUNNING") return t("jobDashboard.statusRunning");
    if (s === "PAUSED") return t("jobDashboard.statusPaused");
    if (s === "STOPPED") return t("jobDashboard.statusStopped");
    if (s === "FAILED") return t("jobDashboard.statusFailed");
    if (s === "DONE") return t("jobDashboard.statusDone");
    if (s === "QUEUED") return t("jobDashboard.statusQueued");
    return value || t("jobDashboard.statusDone");
  };
  const statusLabel = formatStatusLabel(statusText);
  const pctLabel =
    statusText === "RUNNING" && typeof progressPct === "number"
      ? `${progressPct.toFixed(0)}%`
      : statusLabel;
  const canUseDeployActions = historyRows.length > 0 || statusText === "DONE";

  return (
  <Modal open={open} title={t("jobDashboard.title")} onClose={onClose} size="5xl">
      <div className="space-y-4 max-h-[calc(100vh-8rem)] overflow-y-auto pr-1 no-scrollbar">
        {error && (
          <div className="rounded-xl border border-rose-400/50 bg-rose-500/10 px-4 py-3 text-sm text-black">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-lg font-bold text-white/90">{title || t("jobDashboard.job")}</div>
            {description && <div className="text-sm text-white/65">{description}</div>}
            <div className="text-sm text-white/60">{model || t("jobDashboard.model")}</div>
            <div className="text-xs text-white/45">
              {t("jobDashboard.trainId")}: {jobId || "—"}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-end sm:self-end sm:mt-0 mt-1">
            <button
              type="button"
              onClick={() => setShowDetailModal(true)}
              className="h-10 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-[rgb(var(--theme-btn-text))] transition hover:border-white/20 hover:bg-white/10 disabled:opacity-50"
            >
              {t("jobDashboard.detail")}
            </button>
            {canStop ? (
              <button
                type="button"
                onClick={handleStop}
                disabled={controlLoading || !jobId || !canStop}
                className="h-10 rounded-xl border border-rose-400/50 bg-rose-500/15 px-4 text-sm font-semibold text-[rgb(var(--theme-btn-text))] transition hover:border-rose-300/80 hover:bg-rose-500/25 disabled:opacity-50"
              >
                {t("jobDashboard.stop")}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={starting || !jobId || !canStart}
                className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-[rgb(var(--theme-btn-text))] transition hover:bg-blue-500 disabled:opacity-50"
              >
                {starting ? t("common.loading") : t("jobDashboard.start")}
              </button>
            )}
            <button
              type="button"
              onClick={pauseMode === "pause" ? handlePause : handleResume}
              disabled={controlLoading || !jobId || (!canPause && !canResume)}
              className="h-10 w-24 rounded-xl border border-amber-300/40 bg-amber-400/10 px-4 text-sm font-semibold text-[rgb(var(--theme-btn-text))] transition hover:border-amber-300/60 hover:bg-amber-400/20 disabled:opacity-50"
            >
              {pauseMode === "pause" ? t("jobDashboard.pause") : t("jobDashboard.resume")}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={controlLoading || !jobId || !canReset}
              className="h-10 rounded-xl border border-rose-400/50 bg-rose-500/15 px-4 text-sm font-semibold text-rose-500 transition hover:border-rose-300/80 hover:bg-rose-500/25 disabled:opacity-50"
            >
              {t("jobDashboard.reset")}
            </button>
          </div>
        </div>

        <JobDetailModal
          open={showDetailModal}
          onClose={() => setShowDetailModal(false)}
          projectId={projectId}
          jobId={jobId || ""}
          title={title}
          description={description}
          model={model}
          datasetName={datasetName}
          datasetPath={datasetPath}
          epochs={epochs}
          readOnly={!canEdit}
          onUpdated={onUpdated}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr] items-start">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 auto-rows-[220px]">
            <div
              className="h-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 cursor-zoom-in hover:border-white/20 transition"
              onClick={() => setExpandedChart({ label: "TRAIN_LOSS", data: progressData.trainLoss })}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/70 mb-2">
                TRAIN_LOSS
              </div>
              {renderChart("train_loss", progressData.trainLoss)}
            </div>
            <div
              className="h-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 cursor-zoom-in hover:border-white/20 transition"
              onClick={() => setExpandedChart({ label: "VAL_LOSS", data: progressData.valLoss })}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/70 mb-2">
                VAL_LOSS
              </div>
              {renderChart("val_loss", progressData.valLoss)}
            </div>
            {taskType === "classify" ? (
              <>
                <div
                  className="h-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 cursor-zoom-in hover:border-white/20 transition"
                  onClick={() => setExpandedChart({ label: "TRAIN_ACC", data: progressData.trainAcc })}
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/70 mb-2">
                    TRAIN_ACC
                  </div>
                  {renderChart("train_acc", progressData.trainAcc)}
                </div>
                <div
                  className="h-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 cursor-zoom-in hover:border-white/20 transition"
                  onClick={() => setExpandedChart({ label: "VAL_ACC", data: progressData.valAcc })}
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/70 mb-2">
                    VAL_ACC
                  </div>
                  {renderChart("val_acc", progressData.valAcc)}
                </div>
              </>
            ) : (
              <>
                <div
                  className="h-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 cursor-zoom-in hover:border-white/20 transition"
                  onClick={() => setExpandedChart({ label: "PRECISION", data: progressData.precision })}
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/70 mb-2">
                    PRECISION
                  </div>
                  {renderChart("precision", progressData.precision)}
                </div>
                <div
                  className="h-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 cursor-zoom-in hover:border-white/20 transition"
                  onClick={() => setExpandedChart({ label: "RECALL", data: progressData.recall })}
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/70 mb-2">
                    RECALL
                  </div>
                  {renderChart("recall", progressData.recall)}
                </div>
              </>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-4 flex flex-col self-start h-auto lg:h-[calc(2*220px+1rem)]">
            <div className="text-sm font-semibold text-white/80 mb-2">{t("jobDashboard.hyperbandLogs")}</div>
            {jobStatus === "FAILED" && errorReason && (
              <div className="mb-2 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                <div className="font-semibold mb-1">{t("common.error")}</div>
                <div>{interpretError(errorReason)}</div>
              </div>
            )}
            <div
              ref={logContainerRef}
              className="flex-1 min-h-0 rounded-lg border border-white/5 bg-black/30 p-3 text-xs font-mono text-white/80 space-y-1 overflow-y-auto whitespace-pre-line break-words leading-relaxed"
            >
            {buildHyperbandLines().length > 0 ? (
                buildHyperbandLines().slice(-100).map((line, idx) => (
                  <div key={`${idx}-${line}`}>
                    {line}
                  </div>
                ))
              ) : (
                <div className="text-white/60">{t("jobDashboard.logsEmpty")}</div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
          {metricCards.map((m) => (
            <div
              key={m.label}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                {m.label}
              </div>
              <div className="mt-1 text-2xl font-extrabold text-blue-200">
                {m.value === null ? "—" : formatVal(m.value)}
              </div>
            </div>
          ))}
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
              {t("jobDashboard.metrics.status")}
            </div>
            <div className={`mt-1 text-2xl font-extrabold ${statusColors[statusText] || "text-white"}`}>
              {pctLabel}
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-slate-800/70 to-slate-900/80 p-4">
            <div className="flex items-center gap-2 text-sky-200 font-semibold text-sm">
              <span className="text-lg">🏆</span>
              {t("jobDashboard.bestHyper")}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {bestParams.map((p) => (
                <div
                  key={p.label}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 flex items-center gap-2"
                >
                  <span className="text-white/60">{p.label}:</span>
                  <span className="text-amber-200">{p.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between text-white/80 font-semibold text-sm mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">⏱️</span>
                {t("jobDashboard.experimentHistory")}
              </div>
              <button
                type="button"
                onClick={handleSaveExperiment}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80 hover:border-white/30 hover:bg-white/10 transition"
              >
                {t("jobDashboard.save")}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-white/80">
                <thead className="text-white/60 border-b border-white/10">
                  <tr>
                    <th className="py-2 px-2">{t("jobDashboard.trialId")}</th>
                    <th className="py-2 px-2">{t("jobDashboard.hyperparameters")}</th>
                    <th className="py-2 px-2">{t("jobDashboard.epochs")}</th>
                    <th className="py-2 px-2">{t("jobDashboard.score")}</th>
                    <th className="py-2 px-2">{t("jobDashboard.status")}</th>
                    <th className="py-2 px-2">{t("jobDashboard.date")}</th>
                    <th className="py-2 px-2 text-right">{t("jobDashboard.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.length === 0 && (
                    <tr>
                      <td className="py-3 px-2 text-white/50" colSpan={6}>
                        {t("jobDashboard.noHistory")}
                      </td>
                    </tr>
                  )}
                  {historyRows.map((row) => (
                    <tr key={row.id} className="border-b border-white/5">
                      <td className="py-2 px-2">#{row.id}</td>
                      <td className="py-2 px-2 text-white/70">{row.hyper}</td>
                      <td className="py-2 px-2">{row.epochs}</td>
                      <td className="py-2 px-2 text-emerald-200 font-semibold">
                        {row.score !== null && row.score !== undefined ? formatVal(row.score) : "—"}
                      </td>
                      <td className="py-2 px-2">
                        <span
                          className={`text-sm font-semibold ${
                            (row.status || "").toLowerCase() === "done"
                              ? "text-emerald-200"
                              : (row.status || "").toLowerCase() === "failed"
                                ? "text-rose-300"
                                : "text-amber-200"
                          }`}
                        >
                          {formatStatusLabel(row.status)}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-white/60 whitespace-nowrap">
                        {row.date || "—"}
                      </td>
                  <td className="py-2 px-2">
                    <div className="flex justify-end gap-2">
                      <button
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-[rgb(var(--theme-btn-text))] hover:border-white/30 hover:bg-white/10 transition"
                        onClick={() => handleShowDetailRecord(row.dbId)}
                      >
                        {t("jobDashboard.detail")}
                      </button>
                      <button
                        className="rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-500/20 transition"
                        onClick={() => handleDeleteExperiment(row.id, row.dbId)}
                      >
                        {t("train.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="grid w-full grid-cols-1 gap-3 md:max-w-xl md:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setDeployModalOpen(true);
                setDeployStatus("idle");
                setDeployMessage(null);
              }}
              disabled={!canUseDeployActions || deploying || !jobId}
              className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-left shadow-sm transition ${
                canUseDeployActions
                  ? "border-sky-400/40 bg-sky-900/40 hover:border-sky-300/60 hover:bg-sky-900/60"
                  : "border-white/10 bg-white/5 opacity-60 cursor-not-allowed"
              }`}
            >
              <div>
                <div className="text-base font-semibold text-[rgb(var(--theme-btn-text))]">{t("jobDashboard.deployModel")}</div>
                <div className="text-xs text-[rgb(var(--theme-btn-text))/0.7]">{t("jobDashboard.deployDesc")}</div>
              </div>
              <span className="ml-auto text-[rgb(var(--theme-btn-text))/0.7]">›</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setXaiModalOpen(true);
              }}
              disabled={!canUseDeployActions || deploying || !jobId}
              className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-left shadow-sm transition ${
                canUseDeployActions
                  ? "border-violet-400/40 bg-[rgb(var(--theme-panel-soft)/0.8)] hover:border-violet-300/60 hover:bg-[rgb(var(--theme-panel-soft))]"
                  : "border-white/10 bg-white/5 opacity-60 cursor-not-allowed"
              }`}
            >
              <div>
                <div className="text-base font-semibold text-[rgb(var(--theme-btn-text))]">{t("jobDashboard.xai")}</div>
                <div className="text-xs text-[rgb(var(--theme-btn-text))/0.7]">{t("jobDashboard.xaiDesc")}</div>
              </div>
              <span className="ml-auto text-[rgb(var(--theme-btn-text))/0.7]">›</span>
            </button>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteLoading || !jobId}
              className="h-11 rounded-xl border border-rose-400/70 bg-[#2d1223] px-5 text-sm font-semibold text-rose-50 transition hover:border-rose-300 hover:bg-[#35162b] disabled:opacity-50"
            >
              {deleteLoading ? t("common.loading") : t("jobDashboard.deleteTraining")}
            </button>
          </div>
        </div>

        {deployModalOpen && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgb(var(--theme-overlay)/0.7)]"
            onClick={() => {
              setDeployModalOpen(false);
              setDeployStatus("idle");
              setDeployMessage(null);
            }}
          >
            <div
              className="w-[420px] rounded-2xl border border-white/12 bg-[rgb(var(--theme-panel))] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.75)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm font-semibold text-sky-200 mb-3">{t("jobDashboard.deployTitle")}</div>
              <div className="flex flex-col items-center text-center gap-4">
                <div className="text-base font-semibold text-white/90 leading-relaxed whitespace-pre-line">
                  {t("jobDashboard.deploySubtitle")}
                </div>
                {deployStatus === "error" && (
                  <div className="w-full rounded-lg border border-rose-400/50 bg-rose-900/30 px-3 py-2 text-sm text-rose-100">
                    {deployMessage || t("jobDashboard.deployError")}
                  </div>
                )}
                {deployStatus === "success" && (
                  <div className="w-full rounded-lg border border-emerald-400/50 bg-emerald-900/30 px-3 py-2 text-sm text-emerald-100">
                    {deployMessage || t("jobDashboard.deploySuccess")}
                  </div>
                )}
                {deployStatus === "idle" && (
                  <div className="text-xs text-white/60">
                    {t("jobDashboard.deployIdle")}
                  </div>
                )}

                <div className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-left">
                  <div className="text-xs font-semibold text-white/70 mb-2">{t("jobDashboard.saveOptions")}</div>
                  <div className="grid grid-cols-1 gap-2">
                    <label className="text-[11px] text-white/60">
                      {t("jobDashboard.target")}
                      <select
                        value={deployTarget}
                        onChange={(e) => setDeployTarget(e.target.value as any)}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-[rgb(var(--theme-panel))] px-3 py-2 text-sm text-white/90"
                      >
                        <option value="onnx">ONNX (.onnx)</option>
                        <option value="tensorrt">TensorRT (.engine)</option>
                      </select>
                    </label>

                    <label className="text-[11px] text-white/60">
                      {t("jobDashboard.fileName")}
                      <input
                        value={deployOutputName}
                        onChange={(e) => setDeployOutputName(e.target.value)}
                        placeholder={jobId || "job_id"}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-[rgb(var(--theme-panel))] px-3 py-2 text-sm text-white/90"
                      />
                      <div className="mt-1 text-[11px] text-white/45">
                        {t("jobDashboard.savedUnder")}:{" "}
                        <span className="text-white/60">back_end/saved_models/deploy</span>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="flex w-full gap-2">
                  <button
                    type="button"
                    onClick={handleDeploy}
                    disabled={deploying || !jobId}
                    className="flex-1 rounded-lg bg-sky-600 px-4 py-3 text-sm font-semibold text-[rgb(var(--theme-btn-text))] shadow-md transition hover:bg-sky-500 disabled:opacity-60"
                  >
                    {deploying ? t("jobDashboard.deployCreating") : t("jobDashboard.deployCreate")}
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenConvertedFolder}
                    disabled={!jobId}
                    className="rounded-lg border border-white/10 px-4 py-3 text-sm font-semibold text-[rgb(var(--theme-btn-text))] hover:bg-white/5 transition disabled:opacity-60"
                  >
                    {t("common.open")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeployModalOpen(false);
                      setDeployStatus("idle");
                      setDeployMessage(null);
                    }}
                    className="rounded-lg border border-white/10 px-4 py-3 text-sm font-semibold text-[rgb(var(--theme-btn-text))] hover:bg-white/5 transition"
                  >
                    {t("common.close")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {xaiModalOpen && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgb(var(--theme-overlay)/0.7)]"
            onClick={() => setXaiModalOpen(false)}
          >
            <div
              className="w-[920px] max-w-[96vw] rounded-2xl border border-white/12 bg-[rgb(var(--theme-panel-soft))] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.75)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm font-semibold text-violet-200 mb-3">{t("jobDashboard.xaiTitle")}</div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-semibold text-white/70 mb-2">{t("jobDashboard.source")}</div>
                  <select
                    value={xaiSourceKey}
                    onChange={(e) => setXaiSourceKey(e.target.value as any)}
                    className="w-full rounded-lg border border-white/10 bg-[rgb(var(--theme-panel))] px-3 py-2 text-sm text-white/90"
                  >
                    {(xaiSources.length ? xaiSources : [
                      { key: "training_results", label: t("jobDashboard.xaiSourceTraining"), available: true },
                      { key: "dataset_train", label: t("jobDashboard.xaiSourceDatasetTrain"), available: true },
                      { key: "dataset_val", label: t("jobDashboard.xaiSourceDatasetVal"), available: true },
                    ]).map((s) => (
                      <option key={s.key} value={s.key} disabled={!s.available}>
                        {s.label}{!s.available ? ` ${t("jobDashboard.unavailableSuffix")}` : ""}
                      </option>
                    ))}
                  </select>

                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-xs font-semibold text-white/70">{t("jobDashboard.selectImage")}</div>
                    <div className="text-xs text-white/50">{t("jobDashboard.items", { count: xaiImages.length })}</div>
                  </div>

                  {xaiError && (
                    <div className="mt-3 rounded-lg border border-rose-400/40 bg-rose-900/20 px-3 py-2 text-sm text-rose-100">
                      {xaiError}
                    </div>
                  )}

                  <div className="mt-3 max-h-[420px] overflow-y-auto rounded-lg border border-white/10 p-2">
                    {xaiLoading && !xaiImages.length ? (
                      <div className="text-sm text-white/60 px-2 py-3">{t("jobDashboard.loading")}</div>
                    ) : xaiImages.length ? (
                      <div className="grid grid-cols-3 gap-2">
                        {xaiImages.map((img) => {
                          const selected = xaiSelected?.id === img.id;
                          return (
                            <button
                              key={img.id}
                              type="button"
                              onClick={() => {
                                setXaiSelected(img);
                                generateXai(xaiSourceKey, img.id);
                              }}
                              className={`group relative overflow-hidden rounded-lg border transition ${
                                selected
                                  ? "border-violet-300/60 bg-violet-500/10"
                                  : "border-white/10 hover:border-white/20"
                              }`}
                              title={img.label}
                            >
                              <img
                                src={`${API_BASE}${withAuthToken(toNodeFileUrl(img.url))}`}
                                alt={img.label}
                                className="h-20 w-full object-cover opacity-90 group-hover:opacity-100"
                                loading="lazy"
                              />
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-sm text-white/60 px-2 py-3">{t("jobDashboard.noImages")}</div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-xs font-semibold text-white/70">{t("jobDashboard.result")}</div>
                  </div>

                  {!xaiSelected && (
                    <div className="rounded-lg border border-white/10 bg-[rgb(var(--theme-panel)/0.4)] px-4 py-4 text-sm text-white/70">
                      Pick an image from the left to generate a heatmap view.
                    </div>
                  )}

                  {xaiSelected && !xaiPanels && (
                    <div className="rounded-lg border border-white/10 bg-[rgb(var(--theme-panel)/0.4)] px-4 py-4 text-sm text-white/70">
                      {xaiLoading ? t("jobDashboard.generating") : t("jobDashboard.noResultYet")}
                    </div>
                  )}

                  {xaiPanels && (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {([
                        ["original", xaiPanels.original],
                        ["heatmap", xaiPanels.heatmap],
                        ["boxes", xaiPanels.boxes],
                        ["overlay", xaiPanels.overlay],
                      ] as const).map(([key, panel]) => (
                        <div key={key} className="rounded-xl border border-white/10 bg-[rgb(var(--theme-panel)/0.4)] p-3">
                          <div className="text-xs font-semibold text-white/70 mb-2">{panel?.label || key}</div>
                          <div className="aspect-[4/3] overflow-hidden rounded-lg border border-white/10 bg-black/30">
                            {panel?.url ? (
                              <img
                                src={`${API_BASE}${withAuthToken(withCacheBust(toNodeFileUrl(panel.url), xaiCacheBust))}`}
                                alt={panel?.label || key}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-sm text-white/50">
                                Not available
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setXaiModalOpen(false)}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-[rgb(var(--theme-btn-text))] hover:bg-white/10 transition"
                >
                  {t("common.close")}
                </button>
              </div>
            </div>
          </div>
        )}

        {expandedChart && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--theme-overlay)/0.7)]"
            onClick={() => setExpandedChart(null)}
          >
            <div className="max-w-[96vw]" onClick={(e) => e.stopPropagation()}>
              {renderExpandedChart(expandedChart.label, expandedChart.data)}
            </div>
          </div>
        )}

        {detailModal.open && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--theme-overlay)/0.7)] px-4"
            onClick={() => setDetailModal({ open: false, loading: false })}
          >
            <div
              className="max-w-[720px] w-full rounded-2xl border border-white/10 bg-[rgb(var(--theme-panel-strong))] shadow-2xl p-5 text-white"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold tracking-[0.12em] text-white/70">
                  {t("jobDashboard.detailTitle")}
                </div>
                <button
                  type="button"
                  onClick={() => setDetailModal({ open: false, loading: false })}
                  className="h-8 w-8 rounded-full border border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                >
                  ×
                </button>
              </div>
              {detailModal.loading && <div className="text-white/60 text-sm">{t("jobDashboard.detailLoading")}</div>}
              {!detailModal.loading && detailModal.error && (
                <div className="text-rose-300 text-sm">
                  {t("jobDashboard.detailLoadFailed", { reason: detailModal.error })}
                </div>
              )}
              {!detailModal.loading && detailModal.record && (
                <div className="space-y-2 text-sm text-white/80">
                  <div>
                    <span className="text-white/50 mr-2">{t("jobDashboard.detailModel")}:</span>
                    <span>{String(detailModal.record.model ?? model ?? "—")}</span>
                  </div>
                  <div>
                    <span className="text-white/50 mr-2">{t("jobDashboard.detailTask")}:</span>
                    <span>{String((detailModal.record as any)?.task ?? taskType ?? "—")}</span>
                  </div>
                  <div>
                    <span className="text-white/50 mr-2">{t("jobDashboard.detailStatus")}:</span>
                    <span>{String(detailModal.record.status ?? jobStatus ?? "—")}</span>
                  </div>
                  {(() => {
                    const taskValue = String((detailModal.record as any)?.task ?? taskType ?? "detect").toLowerCase();
                    if (taskValue === "classify") {
                      return (
                        <>
                          <div>
                            <span className="text-white/50 mr-2">{t("jobDashboard.metrics.acc")}:</span>
                            <span>{String((detailModal.record?.metrics as any)?.acc ?? "—")}</span>
                          </div>
                          <div>
                            <span className="text-white/50 mr-2">{t("jobDashboard.metrics.precision")}:</span>
                            <span>{String((detailModal.record?.metrics as any)?.precision ?? "—")}</span>
                          </div>
                          <div>
                            <span className="text-white/50 mr-2">{t("jobDashboard.metrics.recall")}:</span>
                            <span>{String((detailModal.record?.metrics as any)?.recall ?? "—")}</span>
                          </div>
                          <div>
                            <span className="text-white/50 mr-2">{t("jobDashboard.metrics.f1")}:</span>
                            <span>{String((detailModal.record?.metrics as any)?.f1 ?? "—")}</span>
                          </div>
                        </>
                      );
                    }
                    return (
                      <>
                        <div>
                          <span className="text-white/50 mr-2">{t("jobDashboard.metrics.map50")}:</span>
                          <span>{String((detailModal.record?.metrics as any)?.map50 ?? "—")}</span>
                        </div>
                        <div>
                          <span className="text-white/50 mr-2">{t("jobDashboard.metrics.map95")}:</span>
                          <span>{String((detailModal.record?.metrics as any)?.map50_95 ?? "—")}</span>
                        </div>
                        <div>
                          <span className="text-white/50 mr-2">{t("jobDashboard.metrics.precision")}:</span>
                          <span>{String((detailModal.record?.metrics as any)?.precision ?? "—")}</span>
                        </div>
                        <div>
                          <span className="text-white/50 mr-2">{t("jobDashboard.metrics.recall")}:</span>
                          <span>{String((detailModal.record?.metrics as any)?.recall ?? "—")}</span>
                        </div>
                      </>
                    );
                  })()}
                  <div>
                    <span className="text-white/50 mr-2">{t("jobDashboard.detailHyperparams")}:</span>
                    <pre className="mt-1 rounded-lg bg-white/5 p-2 text-xs text-white/80 whitespace-pre-wrap">
                      {JSON.stringify(
                        (() => {
                          const cfg = (detailModal.record.trainingConfig ?? hyperparams ?? {}) as unknown;
                          if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return cfg;
                          const { model_name, title, description, ...rest } = cfg as Record<string, unknown>;
                          return rest;
                        })(),
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                  <div>
                    <span className="text-white/50 mr-2">{t("jobDashboard.detailSearchSpace")}:</span>
                    <pre className="mt-1 rounded-lg bg-white/5 p-2 text-xs text-white/80 whitespace-pre-wrap">
                      {JSON.stringify((detailModal.record as any)?.searchSpace ?? {}, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <span className="text-white/50 mr-2">{t("jobDashboard.detailHyperbandLogs")}:</span>
                    <pre className="mt-1 rounded-lg bg-white/5 p-2 text-xs text-white/80 whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {Array.isArray((detailModal.record as any).hyperband_logs)
                        ? ((detailModal.record as any).hyperband_logs as string[]).join("\n")
                        : Array.isArray(detailModal.record.logs)
                          ? serializeLogs(detailModal.record.logs as unknown[]).join("\n")
                          : String(detailModal.record.logs ?? "—")}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
