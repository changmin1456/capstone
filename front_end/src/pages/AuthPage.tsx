import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiLogin, apiRegister } from "../apis/auth.ts";
import { useI18n } from "../i18n";

export default function AuthPage() {
  const nav = useNavigate();
  const { t } = useI18n();

  const [mode, setMode] = useState<"login" | "register">("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    const okEmail = email.trim().length > 0;
    const okPw = password.length > 0;
    if (!okEmail || !okPw) return false;
    if (mode === "register") return passwordConfirm.length > 0 && passwordConfirm === password;
    return true;
  }, [email, password, passwordConfirm, mode]);

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      if (mode === "login") {
        await apiLogin({ email: email.trim(), password });
      } else {
        if (passwordConfirm !== password) throw new Error(t("password.mismatch"));
        await apiRegister({ email: email.trim(), password });
      }

      nav("/projects");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  function switchToRegister() {
    if (submitting) return;
    setMode("register");
    setError(null);
    setPassword("");
    setPasswordConfirm("");
  }

  function switchToLogin() {
    if (submitting) return;
    setMode("login");
    setError(null);
    setPassword("");
    setPasswordConfirm("");
  }

  return (
    <div className="min-h-[calc(100vh-5rem)] flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-7 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
        <div className="space-y-2">
          <div className="text-2xl font-black tracking-tight text-black">
            {mode === "login" ? t("auth.login") : t("auth.createAccount")}
          </div>
          {mode !== "login" && (
            <div className="text-sm text-[rgb(var(--color-text)/0.7)]">
              {t("auth.registerHint")}
            </div>
          )}
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <div className="text-sm font-semibold text-white/80">{t("auth.email")}</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              className="mt-2 w-full h-11 rounded-xl border border-[rgb(var(--color-border))] bg-black/20 px-4 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              placeholder={t("auth.emailPlaceholder")}
              autoComplete="email"
            />
          </div>

          <div>
            <div className="text-sm font-semibold text-white/80">{t("auth.password")}</div>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              disabled={submitting}
              className="mt-2 w-full h-11 rounded-xl border border-[rgb(var(--color-border))] bg-black/20 px-4 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              placeholder={t("auth.passwordPlaceholder")}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          {mode === "register" && (
            <div>
              <div className="text-sm font-semibold text-white/80">{t("auth.passwordConfirm")}</div>
              <input
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                type="password"
                disabled={submitting}
                className="mt-2 w-full h-11 rounded-xl border border-[rgb(var(--color-border))] bg-black/20 px-4 text-white/85 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                placeholder={t("auth.passwordConfirmPlaceholder")}
                autoComplete="new-password"
              />
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-[rgb(var(--color-danger))]">
              {error}
            </div>
          )}

          {mode === "login" ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="w-full h-11 rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-[0_15px_35px_rgba(59,130,246,0.45)] transition hover:bg-blue-500 disabled:opacity-40"
            >
              {submitting ? t("common.loading") : t("auth.login")}
            </button>
          ) : (
            <div className="flex items-center">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit || submitting}
                className="w-full h-11 rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-[0_15px_35px_rgba(59,130,246,0.45)] transition hover:bg-blue-500 disabled:opacity-40"
              >
                {submitting ? t("common.loading") : t("common.create")}
              </button>
            </div>
          )}

          {mode === "login" ? (
            <button
              type="button"
              onClick={switchToRegister}
              disabled={submitting}
              className="w-full text-sm text-black hover:text-black transition"
            >
              {t("auth.switchToRegister")}
            </button>
          ) : (
            <button
              type="button"
              onClick={switchToLogin}
              disabled={submitting}
              className="w-full text-sm text-black hover:text-black transition"
            >
              {t("auth.switchToLogin")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
