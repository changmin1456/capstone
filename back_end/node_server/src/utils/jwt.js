const jwt = require("jsonwebtoken");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;

  // Dev fallback (so the server can boot and local curl tests can run without env wiring).
  // In production you MUST set JWT_SECRET.
  if (process.env.NODE_ENV !== "production") {
    return "dev-jwt-secret-change-me";
  }

  throw new Error("JWT_SECRET is not set");
}

function signAccessToken(payload, opts = {}) {
  const secret = getJwtSecret();
  const expiresIn = opts.expiresIn || process.env.JWT_EXPIRES_IN || "7d";
  return jwt.sign(payload, secret, { expiresIn });
}

function verifyAccessToken(token) {
  const secret = getJwtSecret();
  return jwt.verify(token, secret);
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
};
