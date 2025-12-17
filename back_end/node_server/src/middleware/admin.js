function requireAdmin(req, res, next) {
  const expected =
    process.env.ADMIN_RESET_KEY ||
    (process.env.NODE_ENV !== "production" ? "dev-admin-reset-key-change-me" : "");
  if (!expected) return res.status(500).json({ error: "ADMIN_RESET_KEY is not configured" });

  const got = req.headers["x-admin-key"] || req.headers["X-Admin-Key"];
  if (!got || String(got) !== String(expected)) {
    return res.status(403).json({ error: "Admin key invalid" });
  }

  next();
}

module.exports = {
  requireAdmin,
};
