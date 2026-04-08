import { useEffect, useState } from "react";
import { API_BASE, apiFetch } from "../apis/api";
import { readHttpErrorMessage } from "../utils/httpError";
import { getAuthToken } from "../utils/auth";
import { useI18n } from "../i18n";

type ModelItem = {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  file_path?: string;
  weights_path?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function ModelManagerModal({ open, onClose }: Props) {
  const HEADER_BTN_H = 40; // px
  const { t } = useI18n();
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [cmd, setCmd] = useState("pip install ultralytics");
  const [terminalOutput, setTerminalOutput] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open) return;
    void loadModels();
  }, [open]);

  useEffect(() => {
    if (open) return;
    // Reset expandable sections on close so reopening starts clean.
    setShowTerminal(false);
    setTerminalOutput(null);
    setError(null);
  }, [open]);

  if (!open) return null;

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    try {
  const data = await apiFetch<ModelItem[]>("/api/models");
      setModels(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("projects.apiErrorHelp"));
      setModels([]);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (file?: File) => {
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (ext !== "py") {
      setError(t("models.uploadOnlyPy"));
      return;
    }
    const base = file.name.replace(/\.[^.]+$/, "");
    const form = new FormData();
    form.append("id", base);
    form.append("name", base);
    form.append("model_file", file);

    setUploading(true);
    setError(null);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/models`, {
        method: "POST",
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      });
      if (!res.ok) {
  throw new Error(await readHttpErrorMessage(res));
      }
      const created = (await res.json()) as ModelItem;
      setModels((prev) => [created, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("models.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = window.confirm(t("models.deleteConfirm"));
    if (!ok) return;
    try {
  await apiFetch<void>(`/api/models/${id}`, { method: "DELETE" });
      setModels((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("models.deleteFailed"));
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgb(var(--theme-overlay)/0.55)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="models"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-[rgb(var(--theme-panel-strong))] shadow-[0_30px_120px_rgba(0,0,0,0.65)]">
        <div
          className="border-b border-white/10 bg-white/[0.03] px-6 py-4"
          style={{ ["--mm-btn-h" as never]: `${HEADER_BTN_H}px` } as never}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="mt-1 text-lg font-extrabold text-white/90">{t("models.title")}</div>
            {/* top-right intentionally empty: buttons are anchored bottom-right */}
            <div aria-hidden="true" />
          </div>

          <div className="mt-1 flex items-end justify-between gap-3 min-h-[var(--mm-btn-h)]">
            <div className="text-sm text-white/60 leading-none pb-[3px]">
              {loading ? t("common.loading") : t("models.count", { count: models.length })}
            </div>

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => setShowTerminal((v) => !v)}
                className="h-10 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/10"
              >
                {t("models.terminal")}
              </button>
              <label className="h-10 inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/80 hover:border-white/20 hover:bg-white/10 cursor-pointer transition">
                <input
                  type="file"
                  accept=".py"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    void handleUpload(file || undefined);
                    e.target.value = "";
                  }}
                />
                {uploading ? t("common.loading") : t("models.upload")}
              </label>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="rounded-xl border border-rose-400/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          )}

          {showTerminal && (
            <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-xs font-semibold text-white/60">{t("models.terminalHint")}</div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/90 placeholder:text-white/30 outline-none focus:border-sky-300/40"
                  placeholder="pip install ultralytics"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!cmd.trim()) return;
                    setRunning(true);
                    setError(null);
                    setTerminalOutput(null);
                    try {
                      const data = await apiFetch<{ stdout?: string; stderr?: string }>(
                        "/api/terminal",
                        {
                          method: "POST",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ cmd }),
                        },
                      );
                      setTerminalOutput(
                        [data.stdout || "", data.stderr || ""].filter(Boolean).join("\n") ||
                          "(no output)",
                      );
                    } catch (e) {
                      setTerminalOutput(String(e instanceof Error ? e.message : e));
                    } finally {
                      setRunning(false);
                    }
                  }}
                  disabled={running}
                  className="h-10 rounded-xl border border-sky-300/30 bg-sky-400/15 px-4 text-sm font-semibold text-sky-100 transition hover:border-sky-200/60 hover:bg-sky-400/25 disabled:opacity-50"
                >
                  {running ? t("common.loading") : t("models.run")}
                </button>
              </div>
              <div className="min-h-[140px] rounded-xl border border-white/10 bg-black/20 p-3 font-mono text-xs text-white/80 whitespace-pre-wrap">
                {terminalOutput || t("models.noOutput")}
              </div>
            </div>
          )}

          <div className="max-h-[360px] overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {loading ? (
              <div className="px-4 py-6 text-center text-white/60">{t("common.loading")}</div>
            ) : models.length === 0 ? (
              <div className="px-4 py-6 text-center text-white/60">{t("models.empty")}</div>
            ) : (
              models.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-5 py-4">
                  <div className="text-white font-semibold text-lg">{m.name || m.id}</div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(m.id)}
                    className="h-10 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/70 hover:border-white/20 hover:bg-white/10 transition"
                  >
                    {t("models.delete")}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 bg-white/[0.02] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/10"
          >
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
