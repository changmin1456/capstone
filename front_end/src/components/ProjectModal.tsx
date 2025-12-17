import { useEffect, useMemo, useState } from "react";

import type { Project } from "../apis/projects";

type Props = {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onSave: (payload: { name: string; description?: string }) => Promise<void> | void;
};

export default function ProjectModal({ open, project, onClose, onSave }: Props) {
  const initialName = useMemo(() => project?.name ?? "", [project?.name]);
  const initialDescription = useMemo(() => project?.description ?? "", [project?.description]);

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription);
    setError(null);
    setSaving(false);
  }, [open, initialDescription, initialName]);

  if (!open) return null;

  const canSave = name.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), description: description.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update project");
      setSaving(false);
    }
  };

  const isEdit = Boolean(project?._id);
  const title = isEdit ? "Project Detail" : "Create Project";
  const primaryLabel = isEdit ? "저장" : "생성";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020] shadow-[0_30px_120px_rgba(0,0,0,0.65)]">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-6 py-4">
          <div>
            <div className="mt-1 text-lg font-extrabold text-white/90">{title}</div>
          </div>
          <div aria-hidden="true" />
        </div>

        <div className="px-6 py-5 space-y-4">
          <label className="block">
            <div className="text-xs font-semibold text-white/60">프로젝트 이름</div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/90 placeholder:text-white/30 outline-none focus:border-sky-300/40"
              placeholder="예) 얼굴 인식 프로그램"
              autoFocus
            />
          </label>

          <label className="block">
            <div className="text-xs font-semibold text-white/60">설명</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-2 min-h-[110px] w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/90 placeholder:text-white/30 outline-none focus:border-sky-300/40"
              placeholder="프로젝트 설명"
            />
          </label>

          {project?._id && (
            <div className="text-[11px] text-white/35">
              id: <span className="font-mono">{project._id}</span>
            </div>
          )}

          {error && <div className="text-sm text-rose-200">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 bg-white/[0.02] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/10"
            disabled={saving}
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="h-10 rounded-xl border border-sky-300/30 bg-sky-400/15 px-4 text-sm font-semibold text-sky-100 transition hover:border-sky-200/60 hover:bg-sky-400/25 disabled:opacity-50"
            disabled={!canSave}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
