import { useState } from "react";
import { useI18n } from "../i18n";

type Props = {
  open: boolean;
  onClose: () => void;
  onSave?: (payload: { current: string; next: string; confirm: string }) => Promise<void> | void;
};

export default function PasswordChangeModal({ open, onClose, onSave }: Props) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { t } = useI18n();

  if (!open) return null;

  const handleClose = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setSuccess(null);
    onClose();
  };

  const handleSave = async () => {
    if (!current || !next || !confirm) {
      setError(t("password.required"));
      setSuccess(null);
      return;
    }
    if (next !== confirm) {
      setError(t("password.mismatch"));
      setSuccess(null);
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await onSave?.({ current, next, confirm });
      setSuccess(t("password.success"));
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("password.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgb(var(--theme-overlay)/0.6)] p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[rgb(var(--theme-panel-strong))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-base font-semibold text-white/90">{t("password.title")}</div>
        {(success || error) && (
          <div
            className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
              success
                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                : "border-rose-400/40 bg-rose-500/10 text-rose-100"
            }`}
          >
            {success || error}
          </div>
        )}
        <div className="mt-3 border-t border-white/10" />

        <div className="mt-4 space-y-3">
          <label className="block">
            <div className="text-xs font-semibold text-white/70">{t("password.current")}</div>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 placeholder:text-white/30 outline-none focus:border-white/20"
            />
          </label>

          <label className="block">
            <div className="text-xs font-semibold text-white/70">{t("password.next")}</div>
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 placeholder:text-white/30 outline-none focus:border-white/20"
            />
          </label>

          <label className="block">
            <div className="text-xs font-semibold text-white/70">{t("password.confirm")}</div>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 placeholder:text-white/30 outline-none focus:border-white/20"
            />
          </label>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="h-9 rounded-xl border border-white/10 bg-white/5 px-4 text-xs font-semibold text-[rgb(var(--theme-btn-text))] transition hover:border-white/20 hover:bg-white/10"
            disabled={saving}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="h-9 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-[rgb(var(--theme-btn-text))] transition hover:bg-blue-500 disabled:opacity-60"
            disabled={saving}
          >
            {saving ? t("common.loading") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
