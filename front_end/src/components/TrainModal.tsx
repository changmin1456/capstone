import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Modal from "./Modal";
import { API_BASE } from "../apis/api";
import { readHttpErrorMessage } from "../utils/httpError";

type ModelItem = {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  file_path?: string;
};
type DatasetReport = {
  name: string;
  size: number;
  sizeText: string;
  type: string;
  lastModified: string;
  datasetPath?: string;
  totalImages?: number;
  classes?: { label: string; count: number }[];
  duplicates?: number;
  healthScore?: number;
  imbalance?: boolean;
};

type TrainModalProps = {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  jobId?: string;
  onCreated?: () => void;
  requireProjectId?: boolean;
  existingTitles?: string[];
  titleText?: string;
  initialTitle?: string;
  initialDescription?: string;
  initialModel?: string;
  initialDatasetName?: string;
  initialDatasetPath?: string;
  initialEpochs?: number;
  saveLabel?: string;
  readOnly?: boolean;
};

function prettyBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const v = bytes / Math.pow(k, i);
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function TrainModal({
  open,
  onClose,
  projectId,
  jobId,
  onCreated,
  requireProjectId = false,
  existingTitles = [],
  titleText = "Create New Training",
  initialTitle,
  initialDescription,
  initialModel,
  initialDatasetName,
  initialDatasetPath,
  initialEpochs,
  saveLabel,
  readOnly = false,
}: TrainModalProps) {
  const [trainName, setTrainName] = useState("");
  const [desc, setDesc] = useState("");
  const isDetailMode = Boolean(jobId);

  const [epochs, setEpochs] = useState(initialEpochs ?? 50);
  const [optimizer, setOptimizer] = useState("AdamW");
  const [imageSize, setImageSize] = useState(224);

  const [batchMin, setBatchMin] = useState(16);
  const [batchMax, setBatchMax] = useState(64);
  const [lrMin, setLrMin] = useState(0.0001);
  const [lrMax, setLrMax] = useState(0.01);
  const [momMin, setMomMin] = useState(0.8);
  const [momMax, setMomMax] = useState(0.99);

  const [datasetFile, setDatasetFile] = useState<File | null>(null);
  const [datasetName, setDatasetName] = useState<string>(initialDatasetName || "");
  const [datasetReport, setDatasetReport] = useState<DatasetReport | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadingDataset, setUploadingDataset] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [datasetUploadInfo, setDatasetUploadInfo] = useState<{
    path: string;
    name: string;
    signature: string;
  } | null>(null);
  const [pendingDatasetFile, setPendingDatasetFile] = useState<File | null>(null);
  const [initialDatasetInfo, setInitialDatasetInfo] = useState<{
    path?: string;
    name?: string;
  }>({ path: initialDatasetPath, name: initialDatasetName });

  // modelQuery: selected value shown in the input
  // modelSearch: ephemeral filter used when the dropdown is open
  const [modelQuery, setModelQuery] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [showModelList, setShowModelList] = useState(false);
  const [isDraggingModels, setIsDraggingModels] = useState(false);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [uploadingModel, setUploadingModel] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [baseSlug, setBaseSlug] = useState<string>("");
  const [detailLoaded, setDetailLoaded] = useState(false);
  const [datasetLocked, setDatasetLocked] = useState(false);

  const modelOptions = useMemo(() => {
    const map = new Map<string, ModelItem>();
    models.forEach((m) => map.set(m.id, m));
    const q = modelSearch.toLowerCase();
    const filtered = Array.from(map.values()).filter((m) => {
      const label = (m.name || m.id || "").toLowerCase();
      return label.includes(q);
    });
    if (
      filtered.length === 0 &&
      isDetailMode &&
      initialModel &&
      modelSearch.toLowerCase() === initialModel.toLowerCase()
    ) {
      return Array.from(map.values());
    }
    return filtered;
  }, [initialModel, isDetailMode, modelSearch, models]);

  const datasetInputRef = useRef<HTMLInputElement | null>(null);
  const modelUploadInputRef = useRef<HTMLInputElement | null>(null);
  const modelListRef = useRef<HTMLDivElement | null>(null);
  const dragStartY = useRef(0);
  const dragStartScroll = useRef(0);

  const triggerFileSelect = () => datasetInputRef.current?.click();
  const triggerModelUpload = () => modelUploadInputRef.current?.click();
  const fileSignature = (f: File | null) => (f ? `${f.name}-${f.size}-${f.lastModified}` : "");

  const cancelTempDatasetIfAny = useCallback(async () => {
    // Only cancel temp dataset created by upload/analyze flow in this modal.
    // If we're in detail mode and the dataset came from existing job, we don't touch it.
    const p = datasetUploadInfo?.path;
    if (!p) return;

    try {
      await fetch(`${API_BASE}/api/datasets/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataset_path: p }),
      });
    } catch (err) {
      console.warn("datasets cancel failed", err);
    } finally {
      setDatasetUploadInfo(null);
      setPendingDatasetFile(null);
      setDatasetFile(null);
    }
  }, [datasetUploadInfo?.path]);

  const handleClose = useCallback(() => {
    setShowModelList(false);
  setModelSearch("");
    void cancelTempDatasetIfAny();
    onClose();
  }, [cancelTempDatasetIfAny, onClose]);

  useEffect(() => {
    if (!open) return;
    setTrainName(initialTitle || "");
    setDesc(initialDescription || "");
    setModelQuery(initialModel || "");
  setModelSearch("");
    setSelectedModelId("");
    setDatasetName(initialDatasetName || "");
    setEpochs(initialEpochs ?? 50);
    setInitialDatasetInfo({ path: initialDatasetPath, name: initialDatasetName });
    setBaseSlug((initialTitle || "").toLowerCase().trim());
    if (initialDatasetPath && initialDatasetName) {
      setDatasetUploadInfo({
        path: initialDatasetPath,
        name: initialDatasetName,
        signature: "",
      });
    } else {
      setDatasetUploadInfo(null);
    }
    if (initialDatasetName) {
      setDatasetReport({
        name: initialDatasetName,
        size: 0,
        sizeText: "",
        type: "application/zip",
        lastModified: "",
      });
    } else {
      setDatasetReport(null);
    }
    setInfoMessage(null);
  }, [open, initialTitle, initialDescription, initialModel, initialDatasetName, initialDatasetPath, initialEpochs]);

  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    const loadModels = async () => {
      setLoadingModels(true);
      try {
        const res = await fetch(`${API_BASE}/api/models`);
  if (!res.ok) throw new Error(await readHttpErrorMessage(res));
        const data = (await res.json()) as ModelItem[];
        if (Array.isArray(data)) setModels(data);
        else setModels([]);
  } catch (err) {
        console.error("Failed to load models", err);
        setModels([]);
      } finally {
        setLoadingModels(false);
      }
    };
    void loadModels();
  }, [open]);

  const beginModelDragScroll = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    if (!modelListRef.current) return;
    setIsDraggingModels(true);
    dragStartY.current = e.clientY;
    dragStartScroll.current = modelListRef.current.scrollTop;
  };

  const handleModelDragMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!isDraggingModels || !modelListRef.current) return;
    e.preventDefault();
    const deltaY = e.clientY - dragStartY.current;
    modelListRef.current.scrollTop = dragStartScroll.current - deltaY;
  };

  const stopModelDrag = () => setIsDraggingModels(false);

  const handleModelUpload = async (file?: File) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (ext !== "py") {
      alert("모델 업로드는 .py 파일만 지원합니다. (weights는 추후 추가)");
      return;
    }

    const base = file.name.replace(/\.[^.]+$/, "");
  const form = new FormData();
    form.append("id", base);
    form.append("name", base);
    form.append("model_file", file);

    setUploadingModel(true);
    try {
      const res = await fetch(`${API_BASE}/api/models`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
  throw new Error(await readHttpErrorMessage(res));
      }
      const created = (await res.json()) as ModelItem;
      setModels((prev) => [created, ...prev]);
      setSelectedModelId(created.id);
      setModelQuery(created.name || created.id || "");
      setShowModelList(false);
    } catch (err) {
      console.error("모델 업로드 실패", err);
      alert(String(err));
    } finally {
      setUploadingModel(false);
      if (modelUploadInputRef.current) modelUploadInputRef.current.value = "";
    }
  };

  const runAnalyze = async () => {
    const fileToUse = pendingDatasetFile || datasetFile;

    if (!fileToUse) {
      if (!isDetailMode && !datasetUploadInfo) {
        alert("Dataset(.zip)을 업로드해 주세요.");
        return;
      }
      alert("분석할 Dataset(.zip)을 업로드해 주세요.");
      return;
    }

    setAnalyzing(true);
    try {
      const form = new FormData();
      form.append("dataset", fileToUse);
      if (projectId) form.append("project_id", projectId);
      if (trainName) form.append("title", trainName);

      const res = await fetch(`${API_BASE}/api/datasets/analyze`, {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
  throw new Error(await readHttpErrorMessage(res));
      }

      const json = (await res.json()) as {
        dataset_path?: string;
        dataset_name?: string;
        total_images?: number;
        classes?: { label: string; count: number }[];
        duplicates?: number;
        health_score?: number;
        imbalance?: boolean;
      };

      const rep: DatasetReport = {
        name: json.dataset_name || fileToUse.name,
        size: fileToUse.size,
        sizeText: prettyBytes(fileToUse.size),
        type: fileToUse.type || "application/zip",
        lastModified: new Date(fileToUse.lastModified).toLocaleString(),
        datasetPath: json.dataset_path,
        totalImages: json.total_images,
        classes: json.classes,
        duplicates: json.duplicates,
        healthScore: json.health_score,
        imbalance: json.imbalance,
      };
      setDatasetReport(rep);
      if (json.dataset_path) {
        setDatasetUploadInfo({
          path: json.dataset_path,
          name: rep.name,
          signature: fileSignature(fileToUse),
        });
      }
      setSubmitError(null);
    } catch (err) {
      console.error("analyze failed", err);
      const msg = err instanceof Error ? err.message : "분석에 실패했습니다.";
      setSubmitError(msg);
      alert(msg);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSubmit = async () => {
    if (submitting || uploadingDataset) return;
    if (requireProjectId && !projectId) {
      setSubmitError("projectId가 없습니다. 프로젝트 상세에서 실행해주세요.");
      return;
    }

    // projectId must be a Mongo ObjectId (24-hex). Some UI paths may pass a project name/slug.
    // We try to resolve it to a real id via /api/projects for better UX.
    const resolveProjectId = async (raw?: string): Promise<string | undefined> => {
      if (!raw) return undefined;
      const trimmed = String(raw).trim();
      if (/^[a-fA-F0-9]{24}$/.test(trimmed)) return trimmed;
      try {
        const res = await fetch(`${API_BASE}/api/projects`);
        if (!res.ok) return trimmed;
        const projects = (await res.json()) as Array<{ id?: string; name?: string }>;
        const match = projects.find((p) => (p.name || "").trim() === trimmed);
        return match?.id || trimmed;
      } catch {
        return trimmed;
      }
    };

    const resolvedProjectId = await resolveProjectId(projectId);
    if (requireProjectId && (!resolvedProjectId || !/^[a-fA-F0-9]{24}$/.test(resolvedProjectId))) {
      setSubmitError(
        `Invalid project_id: '${projectId}'. 프로젝트 상세의 실제 프로젝트 id(24자리 ObjectId)를 사용해야 합니다.`,
      );
      return;
    }

    if (!datasetFile && !datasetUploadInfo && !initialDatasetName) {
      setSubmitError("Dataset(.zip)을 선택해주세요.");
      return;
    }

    const normalized = trainName.trim().toLowerCase();
    // 생성 시: 기존 제목과 중복 금지
    if (!isDetailMode) {
      const duplicateTitle = existingTitles.some((t: string) => (t || "").trim().toLowerCase() === normalized);
      if (normalized && duplicateTitle) {
        setSubmitError("이미 동일한 이름의 학습이 있습니다. 다른 이름을 입력해줘.");
        return;
      }
    } else {
      // 수정 시: 기존 제목과 달라졌다면 기존 목록에도 없는지 확인
      if (normalized && normalized !== baseSlug) {
        const duplicateTitle = existingTitles.some((t: string) => (t || "").trim().toLowerCase() === normalized);
        if (duplicateTitle) {
          setSubmitError("이미 동일한 이름의 학습이 있습니다. 다른 이름을 입력해줘.");
          return;
        }
      }
    }

    const resetForm = () => {
      setTrainName("");
      setDesc("");
      setEpochs(50);
      setOptimizer("AdamW");
      setImageSize(224);
      setBatchMin(16);
      setBatchMax(64);
      setLrMin(0.0001);
      setLrMax(0.01);
      setMomMin(0.8);
      setMomMax(0.99);
      setDatasetFile(null);
      setDatasetName("");
      setDatasetReport(null);
      setSelectedModelId("");
      setModelQuery("");
      setShowModelList(false);
    };

    const uploadDataset = async () => {
      const fileToUse = pendingDatasetFile || datasetFile;
      if (!fileToUse) {
        throw new Error("Dataset(.zip)이 선택되지 않았습니다.");
      }
      const sig = fileSignature(fileToUse);
      if (datasetUploadInfo && datasetUploadInfo.signature === sig && datasetUploadInfo.path) {
        return { dataset_path: datasetUploadInfo.path, dataset_name: datasetUploadInfo.name };
      }

      setUploadingDataset(true);
      try {
        const form = new FormData();
        form.append("dataset", fileToUse);
        if (projectId) form.append("project_id", projectId);
        if (trainName) form.append("title", trainName);

        const res = await fetch(`${API_BASE}/api/datasets/upload`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          throw new Error(await readHttpErrorMessage(res));
        }
        const json = (await res.json()) as { dataset_path?: string; dataset_name?: string };
        if (!json.dataset_path) throw new Error("업로드 경로를 받지 못했습니다.");
        setDatasetUploadInfo({
          path: json.dataset_path,
          name: json.dataset_name || fileToUse.name,
          signature: sig,
        });
        return json;
      } finally {
        setUploadingDataset(false);
      }
    };

    setSubmitting(true);
    try {
  const uploaded = datasetFile ? await uploadDataset() : null;
      const selectedModel = selectedModelId
        ? modelOptions.find((m) => m.id === selectedModelId)?.name || selectedModelId
        : "";
      const payload = {
  project_id: resolvedProjectId,
        dataset_path:
          uploaded?.dataset_path || datasetUploadInfo?.path || initialDatasetInfo.path || undefined,
        dataset_name:
          uploaded?.dataset_name ||
          datasetUploadInfo?.name ||
          initialDatasetInfo.name ||
          datasetFile?.name ||
          datasetName ||
          undefined,
        title: trainName || undefined,
        description: desc || undefined,
        lr: lrMin,
        batch_size: batchMin,
        epochs,
        optimizer,
        seed: 42,
        model_name: selectedModel || modelQuery || "resnet18",
        image_size: imageSize,
        search_space: {
          batch_min: batchMin,
          batch_max: batchMax,
          lr_min: lrMin,
          lr_max: lrMax,
          momentum_min: momMin,
          momentum_max: momMax,
        },
      };

      const endpoint = isDetailMode && jobId ? `${API_BASE}/api/jobs/${jobId}` : `${API_BASE}/api/jobs`;
      const method = isDetailMode && jobId ? "PATCH" : "POST";

      const res = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
  setSubmitError(await readHttpErrorMessage(res));
        return;
      }

      // Detail 모드에서 데이터셋이 바뀌었고 이전 파일 경로가 있으면 삭제 요청
      if (isDetailMode) {
        const newPath = payload.dataset_path;
        const oldPath = initialDatasetInfo.path;
        if (oldPath && newPath && newPath !== oldPath) {
          void fetch(`${API_BASE}/api/datasets/delete-path`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ target: oldPath }),
          }).catch(() => {});
        }
      }

      onCreated?.();
      setSubmitError(null);
      if (isDetailMode) {
        setInfoMessage(null);
  onClose();
      } else {
        resetForm();
  onClose();
      }
    } catch (error) {
      console.error("Failed to submit train job", error);
      setSubmitError(error instanceof Error ? error.message : "Failed to submit train job");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedModelName = selectedModelId
    ? modelOptions.find((m) => m.id === selectedModelId)?.name || selectedModelId
    : modelQuery;

  useEffect(() => {
    if (!isDetailMode) {
      setInfoMessage(null);
    }
  }, [open, isDetailMode]);

  // Detail 모드에서 기존 하이퍼파라미터/설정을 불러와 폼에 세팅
  useEffect(() => {
    const loadDetail = async () => {
      if (!open || !isDetailMode || !jobId || detailLoaded) return;
      try {
        const res = await fetch(`${API_BASE}/api/jobs/${jobId}/full`);
        if (!res.ok) return;
        const data = (await res.json()) as { job?: Record<string, unknown> };
  // If history/experiment was saved, backend marks job as dataset_locked.
  setDatasetLocked(Boolean((data.job as any)?.dataset_locked));
        const hyper = (data.job as any)?.hyperparams || {};
        const search = hyper.search_space || {};

        if (typeof hyper.epochs === "number") setEpochs(hyper.epochs);
        if (typeof hyper.lr === "number") setLrMin(hyper.lr);
        if (typeof hyper.batch_size === "number") setBatchMin(hyper.batch_size);
        if (typeof hyper.optimizer === "string") setOptimizer(hyper.optimizer);
        if (typeof hyper.image_size === "number") setImageSize(hyper.image_size);

        if (typeof search.batch_min === "number") setBatchMin(search.batch_min);
        if (typeof search.batch_max === "number") setBatchMax(search.batch_max);
        if (typeof search.lr_min === "number") setLrMin(search.lr_min);
        if (typeof search.lr_max === "number") setLrMax(search.lr_max);
        if (typeof search.momentum_min === "number") setMomMin(search.momentum_min);
        if (typeof search.momentum_max === "number") setMomMax(search.momentum_max);

        if (typeof (data.job as any)?.title === "string") setTrainName((data.job as any).title);
        if (typeof (data.job as any)?.description === "string") setDesc((data.job as any).description);
        if (typeof (data.job as any)?.model === "string") setModelQuery((data.job as any).model);
        setDetailLoaded(true);
      } catch {
        // ignore detail load failure
      }
    };
    void loadDetail();
  }, [API_BASE, detailLoaded, isDetailMode, jobId, open]);

  useEffect(() => {
    if (!open) return;
    if (!isDetailMode) setDetailLoaded(false);
    if (!initialDatasetPath) return;
    if (datasetFile || pendingDatasetFile) return;
    // zip 파일이 아닌 경로는 report API가 404를 내려서 요청하지 않는다.
    if (!initialDatasetPath.toLowerCase().endsWith(".zip")) return;

    const controller = new AbortController();
    const fetchReport = async () => {
      setAnalyzing(true);
      try {
        const url = `${API_BASE}/api/datasets/report?path=${encodeURIComponent(initialDatasetPath)}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(await readHttpErrorMessage(res));
        }
        const data = (await res.json()) as {
          dataset_path?: string;
          dataset_name?: string;
          size?: number;
          type?: string;
          last_modified?: string;
          total_images?: number;
          classes?: { label: string; count: number }[];
          duplicates?: number;
          health_score?: number;
          imbalance?: boolean;
        };
        const rep: DatasetReport = {
          name: data.dataset_name || initialDatasetName || "",
          size: data.size || 0,
          sizeText: prettyBytes(data.size || 0),
          type: data.type || "application/zip",
          lastModified: data.last_modified ? new Date(data.last_modified).toLocaleString() : "",
          datasetPath: data.dataset_path,
          totalImages: data.total_images,
          classes: data.classes,
          duplicates: data.duplicates,
          healthScore: data.health_score,
          imbalance: data.imbalance,
        };
        setDatasetReport(rep);
      } catch (err) {
        if (controller.signal.aborted) return;
        // zip 파일이 없거나 접근 불가하면 조용히 무시
        console.warn("dataset report load failed", err);
      } finally {
        if (!controller.signal.aborted) setAnalyzing(false);
      }
    };

    void fetchReport();
    return () => controller.abort();
  }, [open, initialDatasetPath, initialDatasetName, datasetFile, pendingDatasetFile]);

  const pieSlices = useMemo(() => {
    if (!datasetReport?.classes || typeof datasetReport.totalImages !== "number") return [];
    const total = datasetReport.totalImages;
    const palette = ["#22c55e", "#ef4444", "#f59e0b", "#3b82f6", "#a855f7", "#ec4899"];
    let acc = 0;
    return datasetReport.classes.map((c, idx) => {
      const pct = c.count / total;
      const start = acc;
      const end = acc + pct;
      acc = end;
      return {
        start,
        end,
        label: c.label,
        count: c.count,
        color: palette[idx % palette.length],
      };
    });
  }, [datasetReport]);

  const arcPath = (start: number, end: number) => {
    const polar = (t: number) => {
      const angle = t * Math.PI * 2 - Math.PI / 2;
      const r = 45;
      return { x: 50 + r * Math.cos(angle), y: 50 + r * Math.sin(angle) };
    };
    const s = polar(start);
    const e = polar(end);
    const largeArc = end - start > 0.5 ? 1 : 0;
    return `M 50 50 L ${s.x} ${s.y} A 45 45 0 ${largeArc} 1 ${e.x} ${e.y} Z`;
  };

  return (
    <Modal
      open={open}
      title={titleText}
  onClose={handleClose}
  size="5xl"
    >
      <div className="relative">
        {readOnly && (
          <div className="absolute inset-0 z-20 bg-black/25 backdrop-blur-[1px] pointer-events-auto" />
        )}
        <div
          className={`grid gap-6 lg:grid-cols-[1.15fr_0.85fr] ${readOnly ? "pointer-events-none opacity-70" : ""}`}
          onMouseDownCapture={(e) => {
            const t = e.target as HTMLElement;
            if (!t.closest("[data-model-box='1']")) setShowModelList(false);
          }}
        >
        <div className="space-y-5">
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      {submitError && (
        <div className="rounded-xl border border-rose-400/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {submitError}
        </div>
      )}
      {isDetailMode && infoMessage && (
        <div className="rounded-xl border border-rose-400/60 bg-rose-500/20 px-4 py-3 text-sm text-rose-100">
          {infoMessage}
        </div>
      )}
            <div className="text-sm font-semibold text-blue-200 uppercase tracking-[0.12em]">
              1. Training Info
            </div>

            <div className="text-xs text-white/45">
              projectId: <span className="font-mono">{projectId || "—"}</span>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold text-white/80">Training Name</div>
              <input
                value={trainName}
                onChange={(e) => setTrainName(e.target.value)}
                className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                placeholder="예) YOLOv8 traffic sign"
              />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold text-white/80">Description</div>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className="min-h-[100px] w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                placeholder="학습에 대한 설명"
              />
            </div>

            <div className="space-y-2" data-model-box="1">
              <div className="flex items-center justify-between text-sm font-semibold text-white/80">
                <span>Model</span>
                <span className="text-[11px] text-white/50">
                  {loadingModels ? "불러오는 중..." : `${modelOptions.length}개`}
                </span>
              </div>

              <div className="relative">
                <input
                  value={selectedModelName}
                  onChange={(e) => {
                    // typing = filtering, not changing selection yet
                    setModelSearch(e.target.value);
                    setSelectedModelId("");
                    setShowModelList(true);
                    if (isDetailMode && initialModel && e.target.value !== initialModel) {
                      setInfoMessage("모델이 변경되었습니다.");
                    } else {
                      setInfoMessage(null);
                    }
                  }}
                  onFocus={() => {
                    // behave like a dropdown: reopening shows full list
                    setModelSearch("");
                    setShowModelList(true);
                  }}
                  onBlur={() => setTimeout(() => setShowModelList(false), 120)}
                  placeholder="모델 검색/선택"
                  className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />

                {showModelList && (
                  <div
                    ref={modelListRef}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      beginModelDragScroll(e);
                    }}
                    onMouseMove={handleModelDragMove}
                    onMouseLeave={stopModelDrag}
                    onMouseUp={stopModelDrag}
                    className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-black/95 text-left shadow-lg cursor-grab active:cursor-grabbing backdrop-blur"
                  >
                    {modelOptions.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-white/50">No results</div>
                    ) : (
                      modelOptions.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setSelectedModelId(m.id);
                            setModelQuery(m.name || m.id);
                            setModelSearch("");
                            setShowModelList(false);
                          }}
                            className="w-full px-3 py-2 text-sm text-white/85 text-left hover:bg-white/10"
                          >
                            <div className="flex flex-col items-start">
                              <span>{m.name || m.id}</span>
                            </div>
                          </button>
                        ))
                    )}

                    <div className="border-t border-white/5">
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (uploadingModel) return;
                          triggerModelUpload();
                        }}
                          className="w-full px-3 py-2 text-sm font-semibold text-blue-100 text-left hover:bg-white/10"
                        >
                          {uploadingModel ? "Uploading..." : "내 드라이브에서 모델 불러오기"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

              <input
                ref={modelUploadInputRef}
                type="file"
                accept=".pt,.pth,.onnx,.bin,.h5,.zip"
                className="hidden"
                onChange={(e) => handleModelUpload(e.target.files?.[0])}
              />
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold text-white/80">Dataset (.zip)</div>
              {datasetLocked && (
                <div className="rounded-xl border border-yellow-400/30 bg-yellow-500/10 px-4 py-2 text-sm font-semibold text-yellow-200">
                  데이터셋 변경이 불가능 합니다. (학습 기록 저장됨)
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={datasetFile ? datasetFile.name : datasetName}
                  className={`h-11 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 ${
                    readOnly || datasetLocked ? "opacity-50 cursor-not-allowed pointer-events-none" : "cursor-pointer"
                  }`}
                  placeholder="파일 업로드"
                  readOnly
                  tabIndex={readOnly || datasetLocked ? -1 : 0}
                  onClick={() => {
                    if (readOnly || datasetLocked) return;
                    triggerFileSelect();
                  }}
                />
                <input
                  ref={datasetInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const file = e.target.files?.[0] || null;
                    if (readOnly || datasetLocked) {
                      if (datasetInputRef.current) datasetInputRef.current.value = "";
                      return;
                    }
                    setDatasetFile(file);
                    setPendingDatasetFile(file);
                    setDatasetName(file?.name || "");
                    setDatasetReport(null);
                    setDatasetUploadInfo(null);
                    if (isDetailMode && file && file.name !== initialDatasetName) {
                      setInfoMessage("데이터셋이 변경되었습니다. 적용 시 기존 파일이 교체됩니다.");
                    } else {
                      setInfoMessage(null);
                    }
                  }}
                />
                <button
                  type="button"
                  className="h-11 rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 text-sm font-semibold text-emerald-100 transition hover:border-emerald-400/60 hover:bg-emerald-500/30"
                  onClick={runAnalyze}
                  disabled={analyzing || readOnly || datasetLocked}
                >
                  {analyzing ? "Analyzing..." : "Analyze"}
                </button>
              </div>
            </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-sm font-semibold text-blue-200 uppercase tracking-[0.12em]">
                2. Training Config
              </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-white/70">Optimizer</div>
                <input
                  value={optimizer}
                  onChange={(e) => setOptimizer(e.target.value)}
                  className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  placeholder="AdamW"
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-semibold text-white/70">Image Size</div>
                <input
                  type="number"
                  min={1}
                  value={imageSize}
                  onChange={(e) => setImageSize(Number(e.target.value) || 0)}
                  className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-semibold text-white/70">Epochs</div>
                <input
                  type="number"
                  min={1}
                  value={epochs}
                  onChange={(e) => setEpochs(Number(e.target.value) || 0)}
                  className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                />
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold text-blue-200 uppercase tracking-[0.12em]">
              3. Optuna Search Space
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { label: "Batch Min", value: batchMin, setter: setBatchMin },
                { label: "Batch Max", value: batchMax, setter: setBatchMax },
                { label: "LR Initial Min", value: lrMin, setter: setLrMin },
                { label: "LR Initial Max", value: lrMax, setter: setLrMax },
                { label: "Momentum Min", value: momMin, setter: setMomMin },
                { label: "Momentum Max", value: momMax, setter: setMomMax },
              ].map((item) => (
                <div key={item.label} className="space-y-1">
                  <div className="text-xs font-semibold text-white/70">{item.label}</div>
                  <input
                    type="number"
                    value={item.value}
                    onChange={(e) => item.setter(Number(e.target.value))}
                    className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                handleClose();
              }}
              className="h-11 rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white/80 hover:bg-white/10 transition"
            >
              취소
            </button>

            <button
              type="button"
              disabled={!trainName.trim() || (requireProjectId && !projectId) || submitting || uploadingDataset}
              onClick={handleSubmit}
              className="h-11 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-[0_15px_35px_rgba(59,130,246,0.45)] transition hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600"
            >
              {uploadingDataset
                ? "업로드 중..."
                : submitting
                  ? (saveLabel ? `${saveLabel} 중...` : "생성 중...")
                  : saveLabel || "생성"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/40 p-3 text-left text-white/70 min-h-[420px]">
          {/* Outer wrapper: lets us add more report sections below in the future */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-sm font-semibold text-white/80">Dataset Report</div>

            {!datasetReport ? (
              <div className="mt-6 flex h-[330px] items-center justify-center text-center">
                <div>
                  <div className="text-lg font-bold">Upload &amp; Click Analyze</div>
                  <div className="mt-2 text-sm text-white/50">
                    ( 업로드가 완료되면 자동으로 분석이 시작됩니다. )
                  </div>
                  <div className="mt-4"></div>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
                <div className="flex-1 w-full space-y-2 flex flex-col">
                  {datasetReport.healthScore !== undefined && (
                    <div className="inline-flex items-center rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-200">
                      Health {datasetReport.healthScore} / 100
                    </div>
                  )}
                  <div className="text-white/85 font-semibold break-words">{datasetReport.name}</div>
                  <div className="text-sm text-white/55">
                    Size: <span className="font-mono">{datasetReport.sizeText}</span>
                  </div>
                  <div className="text-sm text-white/55">
                    Type: <span className="font-mono">{datasetReport.type}</span>
                  </div>
                  <div className="text-sm text-white/55">
                    Modified: <span className="font-mono">{datasetReport.lastModified}</span>
                  </div>
                  {datasetReport.totalImages !== undefined && (
                    <div className="text-sm text-white/55">
                      Total Images: <span className="font-mono">{datasetReport.totalImages}</span>
                    </div>
                  )}
                  {datasetReport.duplicates !== undefined && (
                    <div className="text-sm text-amber-200">
                      Duplicates detected: {datasetReport.duplicates}
                    </div>
                  )}
                </div>

                {pieSlices.length > 0 && (
                  <div className="w-full max-w-[220px] rounded-xl border border-white/10 bg-black/30 p-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-white/55">
                      Class Mix
                    </div>
                    <div className="mt-2 flex items-center justify-center">
                      <svg viewBox="0 0 100 100" className="h-40 w-40">
                        {pieSlices.map((slice, idx) => (
                          <path
                            key={`${slice.label}-${idx}`}
                            d={arcPath(slice.start, slice.end)}
                            fill={slice.color}
                            opacity={0.9}
                            stroke="rgba(255,255,255,0.1)"
                            strokeWidth="0.5"
                          />
                        ))}
                        <circle cx="50" cy="50" r="20" fill="#0f172a" opacity={0.9} />
                        <text x="50" y="48" textAnchor="middle" className="fill-white text-[10px] font-semibold">
                          Total
                        </text>
                        <text x="50" y="60" textAnchor="middle" className="fill-white text-[12px] font-bold">
                          {datasetReport.totalImages ?? 0}
                        </text>
                      </svg>
                    </div>
                  </div>
                )}
              </div>

              {datasetReport.imbalance && (
                <div className="w-full rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-sm text-amber-100">
                  Imbalance detected. 일부 클래스 데이터가 부족해요. 증강을 추천합니다.
                </div>
              )}

              {datasetReport.classes && datasetReport.classes.length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {datasetReport.classes.map((c, idx) => (
                    <div
                      key={`${c.label}-${idx}`}
                      className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: pieSlices[idx % pieSlices.length]?.color }}
                      />
                      <span className="font-semibold text-white/85">{c.label}</span>
                      <span className="text-white/55">{c.count}</span>
                    </div>
                  ))}
                </div>
              )}
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </Modal>
  );
}
