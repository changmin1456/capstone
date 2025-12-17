import { useEffect } from "react";

export default function Modal({
  open,
  title,
  onClose,
  hideCloseButton = false,
  centered = false,
  size = "lg",
  footer,
  children,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  hideCloseButton?: boolean;
  centered?: boolean;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl";
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const maxW =
    size === "sm"
      ? "max-w-sm"
      : size === "md"
        ? "max-w-md"
        : size === "lg"
          ? "max-w-lg"
          : size === "xl"
            ? "max-w-xl"
            : size === "2xl"
              ? "max-w-2xl"
              : size === "3xl"
                ? "max-w-3xl"
                : size === "4xl"
                  ? "max-w-4xl"
                  : "max-w-5xl";

  return (
  <div className="fixed inset-0 z-50">
      {/* backdrop */}
      <div
    className="absolute inset-0 bg-black/55"
        onClick={onClose}
      />

      {/* panel */}
      <div
        className={
          centered
  ? `absolute left-1/2 top-1/2 w-full ${maxW} -translate-x-1/2 -translate-y-1/2 p-4`
  : `absolute left-1/2 top-4 w-full ${maxW} -translate-x-1/2 p-4`
        }
      >
    <div className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020] shadow-[0_30px_120px_rgba(0,0,0,0.65)]">
      <div className="relative flex max-h-[calc(100vh-2rem)] flex-col">
            {(title || !hideCloseButton) && (
              <div className="flex items-start justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-6 py-4">
                <div>
                  {title && (
                    <div className="mt-1 text-lg font-extrabold text-white/90">
                      {title}
                    </div>
                  )}
                </div>

                {hideCloseButton ? (
                  <div aria-hidden="true" />
                ) : (
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-9 w-9 rounded-full border border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/80 transition"
                    aria-label="close"
                  >
                    ×
                  </button>
                )}
              </div>
            )}

            <div className="px-6 py-5 overflow-y-auto">{children}</div>

            {footer && (
              <div className="flex items-center justify-end gap-2 border-t border-white/10 bg-white/[0.02] px-6 py-4">
                {footer}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
