import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";

export default function NewProjectPage() {
  const nav = useNavigate();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-8">
      <div className="text-white/90 text-xl font-extrabold tracking-tight">
        {t("newProject.title")}
      </div>
      <div className="mt-2 text-white/50 text-sm">
        {t("newProject.subtitle")}
      </div>

      <div className="mt-8 space-y-5">
        <div>
          <div className="text-sm font-semibold text-white/80">{t("projects.projectName")}</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-2 w-full h-11 rounded-xl border border-white/10 bg-black/20 px-4 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            placeholder={t("projects.projectNamePlaceholder")}
          />
        </div>

        <div>
          <div className="text-sm font-semibold text-white/80">{t("projects.description")}</div>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            className="mt-2 w-full min-h-[110px] rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            placeholder={t("projects.descriptionPlaceholder")}
          />
        </div>

        <div className="pt-2 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => nav(-1)}
            className="h-11 rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-white/80 hover:bg-white/10 transition"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => {
              // ✅ 백엔드 붙이기 전 임시 동작
              // 나중에 POST /api/projects 성공하면 상세로 이동시키면 됨
              nav("/projects");
            }}
            className="h-11 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-[0_15px_35px_rgba(59,130,246,0.45)] transition hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600"
          >
            {t("common.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
