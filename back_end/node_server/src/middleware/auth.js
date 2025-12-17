const { toObjectId } = require("../db/mongo");
const { verifyAccessToken } = require("../utils/jwt");

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization;
  if (!h) return null;
  const [type, token] = String(h).split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
}

function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Missing Bearer token" });
    }

    const decoded = verifyAccessToken(token);
    const userId = decoded && decoded.sub;
    const email = decoded && decoded.email;
  const role = decoded && decoded.role;
    if (!userId) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.user = {
      id: String(userId),
      _id: toObjectId(String(userId)),
      email: email ? String(email) : undefined,
  role: role ? String(role) : "user",
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = {
  requireAuth,
};
