import { useState } from "react";
import { useI18n } from "../i18n";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm?: () => Promise<void> | void;
};

export default function AccountDeleteModal({ open, onClose, onConfirm }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  if (!open) return null;

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      await onConfirm?.();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("accountDelete.failed"));
    } finally {
      setLoading(false);
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
        <div className="text-base font-semibold text-black">{t("accountDelete.title")}</div>
        {error && (
          <div className="mt-3 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-600">
            {error}
          </div>
        )}
        <div className="mt-3 border-t border-white/10" />
        <div className="mt-4 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-600">
          <div className="font-semibold text-rose-700">{t("accountDelete.question")}</div>
          <div className="mt-1">
            {t("accountDelete.warning")}
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="h-9 rounded-xl border border-white/10 bg-white/5 px-4 text-xs font-semibold text-black transition hover:border-white/20 hover:bg-white/10"
            disabled={loading}
          >
            {t("accountDelete.cancel")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="h-9 rounded-xl border border-rose-400/50 bg-rose-500/15 px-4 text-xs font-semibold text-rose-600 transition hover:border-rose-300/70 hover:bg-rose-500/25"
            disabled={loading}
          >
            {loading ? t("common.loading") : t("accountDelete.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
