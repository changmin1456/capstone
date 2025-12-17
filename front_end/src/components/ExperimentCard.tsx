import { useEffect, useRef, useState } from "react";
import StatusPill, { type ExperimentStatus } from "./StatusPill";

export type Experiment = {
  id: string;
  status: ExperimentStatus;
  rawStatus?: string;
  title: string;
  model: string;
  description?: string;
  epochs: number;
  date: string;
  datasetName?: string;
  datasetPath?: string;
  projectId?: string;
};

type Props = {
  item: Experiment;
  onDelete?: (id: string) => void;
  onView?: (id: string) => void;
  onEpochChange?: (id: string, epochs: number) => Promise<void> | void;
};

export default function ExperimentCard({ item, onDelete, onView, onEpochChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [epochDraft, setEpochDraft] = useState(item.epochs.toString());
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) {
      setEpochDraft(item.epochs.toString());
    }
  }, [item.epochs, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleEpochClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setEditing(true);
    setEpochDraft(item.epochs.toString());
  };

  const commitEpoch = async () => {
    if (!editing) return;
    const val = Number(epochDraft);
    if (!Number.isFinite(val) || val <= 0) {
      setEpochDraft(item.epochs.toString());
      setEditing(false);
      return;
    }
    try {
      setBusy(true);
      await onEpochChange?.(item.id, Math.round(val));
      setEditing(false);
    } catch (err) {
      setEpochDraft(item.epochs.toString());
      setEditing(false);
      alert(err instanceof Error ? err.message : "업데이트에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onView?.(item.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onView?.(item.id);
        }
      }}
      className="
        group relative overflow-hidden rounded-2xl
        border border-white/10 bg-gradient-to-br from-white/8 via-white/[0.04] to-white/[0.02]
        shadow-[0_20px_60px_rgba(0,0,0,0.45)]
        transition-all duration-200
        hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_28px_80px_rgba(0,0,0,0.55)]
        min-h-[240px]
        w-full
        text-left
      "
    >
      {/* 카드 글로우 */}
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute -top-28 -left-24 h-72 w-72 rounded-full bg-blue-500/18 blur-3xl" />
        <div className="absolute -top-32 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-white/8 blur-3xl" />
      </div>

      <div className="relative p-6">
        <div className="flex items-start justify-between gap-3">
          <StatusPill status={item.status} />
          <div className="flex items-center gap-3 text-xs text-white/60">
            <span>{item.date}</span>
            <div
              role="button"
              tabIndex={0}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white/80"
              aria-label="close"
              title="close"
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.(item.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onDelete?.(item.id);
                }
              }}
            >
              ×
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <div className="text-xl font-extrabold tracking-tight text-white/90">
            {item.title}
          </div>
          <div className="mt-1 text-sm text-white/45">{item.model}</div>
        </div>

        <div className="mt-6 rounded-xl border border-white/10 bg-black/30 px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-white/45">Epochs</div>
            {editing ? (
              <input
                ref={inputRef}
                autoFocus
                type="text"
                inputMode="numeric"
                value={epochDraft}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEpochDraft(e.target.value)}
                onBlur={commitEpoch}
                onKeyDown={(e) => {
                  // Prevent Enter (and other key events) from bubbling to the card handler,
                  // which would open the dashboard.
                  e.stopPropagation();
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    const val = Number(epochDraft);
                    const next = Number.isFinite(val) && val > 0 ? val + 1 : 1;
                    setEpochDraft(next.toString());
                    return;
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    const val = Number(epochDraft);
                    const next = Number.isFinite(val) && val > 1 ? val - 1 : 1;
                    setEpochDraft(next.toString());
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitEpoch();
                  }
                  if (e.key === "Escape") {
                    setEditing(false);
                    setEpochDraft(item.epochs.toString());
                  }
                }}
                className="w-20 bg-transparent px-0 py-0 text-right text-lg font-extrabold text-white/85 focus:outline-none border-none outline-none"
                disabled={busy}
                style={{
                  appearance: "none",
                  WebkitAppearance: "none",
                  MozAppearance: "textfield",
                }}
              />
            ) : (
              <button
                type="button"
                onClick={handleEpochClick}
                className="text-lg font-extrabold text-white/80 transition hover:text-white disabled:opacity-50"
                disabled={busy}
              >
                {item.epochs}
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 text-sm font-semibold text-blue-300/90 transition group-hover:text-blue-200">
          <span>View Result</span>
          <span className="text-blue-300/70 transition group-hover:translate-x-0.5 group-hover:text-blue-200">
            →
          </span>
        </div>
      </div>
    </div>
  );
}
