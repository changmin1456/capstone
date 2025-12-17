export type ExperimentStatus = "DONE" | "RUNNING" | "FAILED" | "QUEUED" | "STOPPED" | "PAUSED";

const STATUS_THEME: Record<
  ExperimentStatus,
  { bg: string; text: string; border: string; glow?: string }
> = {
  DONE: { bg: "bg-emerald-500/15", text: "text-emerald-200", border: "border-emerald-500/40" },
  RUNNING: { bg: "bg-sky-500/15", text: "text-sky-200", border: "border-sky-400/40" },
  FAILED: { bg: "bg-rose-600/20", text: "text-rose-100", border: "border-rose-500/50" },
  QUEUED: { bg: "bg-emerald-500/15", text: "text-emerald-100", border: "border-emerald-400/40" },
  PAUSED: { bg: "bg-amber-400/25", text: "text-amber-50", border: "border-amber-300/60" },
  STOPPED: { bg: "bg-rose-600/20", text: "text-rose-100", border: "border-rose-500/50" }, // STOPPED는 FAILED와 동일 톤
};

export default function StatusPill({ status }: { status: ExperimentStatus }) {
  const theme = STATUS_THEME[status] || STATUS_THEME.FAILED;
  const base =
    "px-3 py-1 rounded-md text-[11px] font-black tracking-wide border shadow-[0_6px_20px_rgba(0,0,0,0.25)] uppercase transition-colors";

  return (
    <span className={`${base} ${theme.bg} ${theme.text} ${theme.border}`}>
      {status}
    </span>
  );
}
