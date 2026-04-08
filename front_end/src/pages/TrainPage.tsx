import { useState } from "react";
import { useParams } from "react-router-dom";
import TrainModal from "../components/TrainModal";
import { useI18n } from "../i18n";

export default function TrainPage() {
  const { projectId } = useParams(); // ✅ 프로젝트 상세에서 들어올 거니까 param 받기
  const [open, setOpen] = useState(true);
  const { t } = useI18n();

  return (
    <div className="min-h-[60vh] rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <style>{`
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button {
          filter: invert(1);
        }
      `}</style>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-11 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(59,130,246,0.45)] transition hover:bg-blue-500"
        >
          {t("train.newTraining")}
        </button>
      </div>

      <TrainModal open={open} onClose={() => setOpen(false)} projectId={projectId} />
    </div>
  );
}
