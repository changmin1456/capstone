import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import PasswordChangeModal from "./PasswordChangeModal";
import { apiChangePassword, apiDeleteAccount } from "../apis/auth";
import AccountDeleteModal from "./AccountDeleteModal";
import { getAuthEmail } from "../utils/auth";
import { applyTheme, getStoredTheme, type ThemeMode } from "../utils/theme";
import { useI18n } from "../i18n";
import {
  getDefaultEpochs,
  getDefaultModel,
  setDefaultEpochs as storeDefaultEpochs,
  setDefaultModel as storeDefaultModel,
  type DefaultEpochs,
  type DefaultModel,
} from "../utils/trainingDefaults";

type Props = {
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
};

export default function SettingsModal({ open, onClose, onLogout }: Props) {
  const email = getAuthEmail();
  const initial = (email || "U").trim().charAt(0).toUpperCase();
  const [activeKey, setActiveKey] = useState("account");
  const [openSelectKey, setOpenSelectKey] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredTheme());
  const { t, lang, setLang } = useI18n();
  const [language, setLanguage] = useState<"ko" | "en">(lang);
  const [autoUpdate, setAutoUpdate] = useState<"on" | "off">("off");
  const [defaultModel, setDefaultModel] = useState<DefaultModel>(() => getDefaultModel());
  const [defaultEpochs, setDefaultEpochs] = useState<DefaultEpochs>(() => getDefaultEpochs());
  const [graphSmoothing, setGraphSmoothing] = useState<"on" | "off">("on");
  const [logRetention, setLogRetention] = useState<"2000" | "5000">("2000");
  const [updateInterval, setUpdateInterval] = useState<"1.5s" | "3s">("1.5s");
  const [runsPath, setRunsPath] = useState<"default" | "custom">("default");
  const [xaiRetention, setXaiRetention] = useState<"on" | "off">("off");
  const [autoCleanup, setAutoCleanup] = useState<"on" | "off">("off");
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode]);

  useEffect(() => {
    storeDefaultModel(defaultModel);
  }, [defaultModel]);

  useEffect(() => {
    storeDefaultEpochs(defaultEpochs);
  }, [defaultEpochs]);

  useEffect(() => {
    setLanguage(lang);
  }, [lang]);

  useEffect(() => {
    if (!openSelectKey) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest('[data-select-root="true"]')) return;
      setOpenSelectKey(null);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [openSelectKey]);
  const items = useMemo(
    () => [
      { key: "account", label: t("settings.account"), icon: "👤" },
      { key: "general", label: t("settings.general"), icon: "⚙️" },
      { key: "training", label: t("settings.training"), icon: "🎓" },
      { key: "monitoring", label: t("settings.monitoring"), icon: "📈" },
      { key: "storage", label: t("settings.storage"), icon: "🗂️" },
      { key: "about", label: t("settings.about"), icon: "ℹ️" },
    ],
    [t],
  );

  const active = items.find((it) => it.key === activeKey) || items[0];
  const renderHero = (title: string, desc: string, icon: string) => (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex flex-col gap-3">
      <div className="h-14 w-14 rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center text-2xl">
        {icon}
      </div>
      <div className="text-lg font-semibold text-white/90">{title}</div>
      <div className="text-sm text-white/55">{desc}</div>
    </div>
  );

  const renderSelect = (
    key: string,
    value: string,
    options: { value: string; label: string }[],
    onChange: (next: string) => void,
    direction: "down" | "up" = "down",
  ) => {
    const activeLabel = options.find((opt) => opt.value === value)?.label || value;
    const open = openSelectKey === key;
    return (
      <div className="relative min-w-[160px]" data-select-root="true">
        <button
          type="button"
          onClick={() => setOpenSelectKey(open ? null : key)}
          className="h-9 w-full rounded-full border border-white/10 bg-black/30 px-4 text-xs font-semibold text-white/80 flex items-center justify-between gap-2 hover:border-white/20 hover:bg-white/5 transition"
        >
          <span>{activeLabel}</span>
          <span className={`text-white/40 transition ${open ? "rotate-180" : ""}`}>⌃</span>
        </button>
        {open && (
          <div
            className={`absolute right-0 z-30 w-full rounded-xl border border-white/10 bg-[rgb(var(--theme-panel-strong))] p-1 shadow-[0_20px_50px_rgba(0,0,0,0.4)] ${
              direction === "up" ? "bottom-[44px]" : "top-[44px]"
            }`}
          >
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpenSelectKey(null);
                  }}
                  className={`w-full rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${
                    active
                      ? "bg-blue-600/90 text-white"
                      : "text-white/70 hover:bg-white/5"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderList = (
    rows: {
      title: string;
      detail?: string;
      control?: React.ReactNode;
    }[],
  ) => (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/5 overflow-visible">
      {rows.map((row) => (
        <div key={row.title} className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-white/85">{row.title}</div>
            {row.detail && <div className="text-xs text-white/50 mt-1">{row.detail}</div>}
          </div>
          <div>{row.control ?? <div className="text-white/30">›</div>}</div>
        </div>
      ))}
    </div>
  );

  const renderContent = () => {
    if (active.key === "account") {
      return (
        <>
          {renderHero(t("settings.account"), t("settings.accountDesc"), "👤")}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="h-12 w-12 rounded-full border border-white/15 bg-white/10 text-sm font-semibold text-white/80 flex items-center justify-center">
                {initial}
              </div>
              <div className="min-w-0 overflow-visible">
                <div className="text-sm font-semibold text-white/90">{t("settings.signedIn")}</div>
                <div className="text-xs text-white/60 break-all whitespace-normal">{email || "user"}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="h-10 rounded-xl border border-rose-400/50 bg-rose-500/15 px-4 text-sm font-semibold text-rose-600 transition hover:border-rose-300/80 hover:bg-rose-500/25"
            >
              {t("settings.logout")}
            </button>
          </div>
          {renderList([
            {
              title: t("settings.passwordChange"),
              detail: t("settings.passwordChangeDesc"),
              control: (
                <button
                  type="button"
                  onClick={() => setPasswordModalOpen(true)}
                  className="h-9 rounded-xl border border-white/10 bg-white/5 px-4 text-xs font-semibold text-black transition hover:border-white/20 hover:bg-white/10"
                >
                  {t("settings.passwordChangeButton")}
                </button>
              ),
            },
            {
              title: t("settings.accountDelete"),
              detail: t("settings.accountDeleteDesc"),
              control: (
                <button
                  type="button"
                  className="h-9 rounded-xl border border-rose-400/50 bg-rose-500/10 px-4 text-xs font-semibold text-rose-600 transition hover:border-rose-300/70 hover:bg-rose-500/20"
                  onClick={() => setDeleteModalOpen(true)}
                >
                  {t("settings.accountDeleteButton")}
                </button>
              ),
            },
          ])}
        </>
      );
    }
    if (active.key === "general") {
      return (
        <>
          {renderHero(t("settings.general"), t("settings.generalDesc"), "⚙️")}
          {renderList([
            {
              title: t("settings.theme"),
              control: renderSelect(
                "theme",
                themeMode,
                [
                  { value: "default", label: t("settings.modeDefault") },
                  { value: "dark", label: t("settings.modeDark") },
                  { value: "light", label: t("settings.modeLight") },
                ],
                (v) => setThemeMode(v as ThemeMode),
              ),
            },
            {
              title: t("settings.language"),
              control: renderSelect(
                "language",
                language,
                [
                  { value: "ko", label: t("settings.korean") },
                  { value: "en", label: t("settings.english") },
                ],
                (v) => {
                  setLanguage(v as typeof language);
                  setLang(v as typeof language);
                },
              ),
            },
            {
              title: t("settings.autoUpdate"),
              control: renderSelect(
                "autoUpdate",
                autoUpdate,
                [
                  { value: "on", label: t("settings.on") },
                  { value: "off", label: t("settings.off") },
                ],
                (v) => setAutoUpdate(v as typeof autoUpdate),
              ),
            },
          ])}
        </>
      );
    }
    if (active.key === "training") {
      return (
        <>
          {renderHero(t("settings.training"), t("settings.trainingDesc"), "🎓")}
          {renderList([
            {
              title: t("settings.defaultModel"),
              control: renderSelect(
                "defaultModel",
                defaultModel,
                [
                  { value: "yolov8n", label: "yolov8n" },
                  { value: "yolov8s", label: "yolov8s" },
                  { value: "yolov8m", label: "yolov8m" },
                ],
                (v) => setDefaultModel(v as typeof defaultModel),
              ),
            },
            {
              title: t("settings.defaultEpochs"),
              control: renderSelect(
                "defaultEpochs",
                defaultEpochs,
                [
                  { value: "10", label: "10" },
                  { value: "50", label: "50" },
                  { value: "100", label: "100" },
                ],
                (v) => setDefaultEpochs(v as typeof defaultEpochs),
              ),
            },
          ])}
        </>
      );
    }
    if (active.key === "monitoring") {
      return (
        <>
          {renderHero(t("settings.monitoring"), t("settings.monitoringDesc"), "📈")}
          {renderList([
            {
              title: t("settings.graphSmoothing"),
              control: renderSelect(
                "graphSmoothing",
                graphSmoothing,
                [
                  { value: "on", label: t("settings.on") },
                  { value: "off", label: t("settings.off") },
                ],
                (v) => setGraphSmoothing(v as typeof graphSmoothing),
                "up",
              ),
            },
            {
              title: t("settings.logRetention"),
              control: renderSelect(
                "logRetention",
                logRetention,
                [
                  { value: "2000", label: "2,000" },
                  { value: "5000", label: "5,000" },
                ],
                (v) => setLogRetention(v as typeof logRetention),
                "up",
              ),
            },
            {
              title: t("settings.updateInterval"),
              control: renderSelect(
                "updateInterval",
                updateInterval,
                [
                  { value: "1.5s", label: "1.5s" },
                  { value: "3s", label: "3s" },
                ],
                (v) => setUpdateInterval(v as typeof updateInterval),
                "up",
              ),
            },
          ])}
        </>
      );
    }
    if (active.key === "storage") {
      return (
        <>
          {renderHero(t("settings.storage"), t("settings.storageDesc"), "🗂️")}
          {renderList([
            {
              title: t("settings.runsPath"),
              control: renderSelect(
                "runsPath",
                runsPath,
                [
                  { value: "default", label: t("settings.modeDefault") },
                  { value: "custom", label: t("settings.custom") },
                ],
                (v) => setRunsPath(v as typeof runsPath),
                "up",
              ),
            },
            {
              title: t("settings.xaiRetention"),
              control: renderSelect(
                "xaiRetention",
                xaiRetention,
                [
                  { value: "on", label: t("settings.on") },
                  { value: "off", label: t("settings.off") },
                ],
                (v) => setXaiRetention(v as typeof xaiRetention),
                "up",
              ),
            },
            {
              title: t("settings.autoCleanup"),
              control: renderSelect(
                "autoCleanup",
                autoCleanup,
                [
                  { value: "on", label: t("settings.on") },
                  { value: "off", label: t("settings.off") },
                ],
                (v) => setAutoCleanup(v as typeof autoCleanup),
                "up",
              ),
            },
          ])}
        </>
      );
    }
    return (
      <>
        {renderHero(t("settings.about"), t("settings.aboutDesc"), "ℹ️")}
        {renderList([
          { title: t("settings.aboutVersion"), detail: "v0.1 test" },
          { title: t("settings.aboutBuild"), detail: "capston" },
          { title: t("settings.aboutLicense"), detail: "Internal" },
        ])}
      </>
    );
  };

  return (
    <>
      <Modal
        open={open}
        title={t("settings.title")}
        onClose={onClose}
        size="5xl"
        centered
        panelClassName="overflow-visible"
        bodyClassName="overflow-visible"
        bodyScroll={false}
      >
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_1fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/60">
              {t("settings.search")}
            </div>
            <div className="mt-4 space-y-1">
              {items.map((it) => {
                const activeRow = it.key === activeKey;
                return (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => setActiveKey(it.key)}
                    className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
                      activeRow
                        ? "bg-blue-600/80 text-white shadow-[0_10px_20px_rgba(37,99,235,0.35)]"
                        : "text-white/70 hover:bg-white/5"
                    }`}
                  >
                    <span className="text-base">{it.icon}</span>
                    <span className="font-semibold">{it.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-4">{renderContent()}</div>
          </div>
        </div>
      </Modal>
      <PasswordChangeModal
        open={passwordModalOpen}
        onClose={() => setPasswordModalOpen(false)}
        onSave={async ({ current, next }) => {
          await apiChangePassword({ currentPassword: current, newPassword: next });
        }}
      />
      <AccountDeleteModal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={async () => {
          await apiDeleteAccount();
          setDeleteModalOpen(false);
          onLogout();
        }}
      />
    </>
  );
}
