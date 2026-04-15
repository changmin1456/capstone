const express = require("express");

const { ensureIndexes, findByEmail, findById, createUser, deleteUserById, setPasswordHashById, createPasswordResetRequestByEmail, consumePasswordResetTokenAndSetPassword } = require("../db/users");
const { hashPassword, verifyPassword } = require("../utils/password");
const { signAccessToken } = require("../utils/jwt");
const { requireAuth } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/admin");

const router = express.Router();
const ADMIN_LOGIN_ID = "admin";

function isEmailFormat(value) {
  return String(value || "").includes("@");
}

function isAdminLoginId(value) {
  return String(value || "").trim().toLowerCase() === ADMIN_LOGIN_ID;
}

function publicUser(u) {
  return {
    id: String(u._id),
    email: u.email,
  role: u.role || "user",
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register new user
 *     tags: [Auth]
 */
router.post("/auth/register", async (req, res) => {
  try {
    await ensureIndexes();

    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !isEmailFormat(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const exists = await findByEmail(email);
    if (exists) {
      return res.status(409).json({ error: "Email already exists" });
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser({ email, passwordHash });

    const token = signAccessToken({
      sub: String(user._id),
      email: user.email,
      role: user.role || "user",
    });
    return res.json({ token, user: publicUser(user) });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to register" });
  }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login
 *     tags: [Auth]
 */
router.post("/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    const user = await findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signAccessToken({
      sub: String(user._id),
      email: user.email,
      role: user.role || "user",
    });
    return res.json({ token, user: publicUser(user) });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to login" });
  }
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user
 *     tags: [Auth]
 */
router.get("/auth/me", requireAuth, async (req, res) => {
  // req.user injected by middleware
  return res.json({
    user: { id: req.user.id, email: req.user.email, role: req.user.role || "user" },
  });
});

/**
 * @swagger
 * /api/auth/me:
 *   delete:
 *     summary: Delete current user
 *     tags: [Auth]
 */
router.delete("/auth/me", requireAuth, async (req, res) => {
  try {
    const r = await deleteUserById(req.user.id);
    return res.json({ deleted: r.deletedCount === 1 });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to delete" });
  }
});

/**
 * @swagger
 * /api/auth/password:
 *   post:
 *     summary: Change current user's password
 *     tags: [Auth]
 */
router.post("/auth/password", requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Missing passwords" });
    }

    const user = await findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid current password" });
    }

    const passwordHash = await hashPassword(newPassword);
    await setPasswordHashById(req.user.id, passwordHash);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to update password" });
  }
});

/**
 * ADMIN reset flow (no email):
 * 1) user requests reset -> server generates token (admin can read token from response/log)
 * 2) admin applies reset with x-admin-key + token
 */

/**
 * @swagger
 * /api/auth/password-reset/request:
 *   post:
 *     summary: Request password reset (admin-assisted)
 *     tags: [Auth]
 */
router.post("/auth/password-reset/request", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || (!isEmailFormat(email) && !isAdminLoginId(email))) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const r = await createPasswordResetRequestByEmail(email);
    // For privacy, don't reveal whether account exists.
    // In this project we still return token when user exists to enable admin-assisted resets.
    if (!r) {
      return res.json({ ok: true });
    }

    return res.json({ ok: true, resetToken: r.token, requestedAt: r.requestedAt });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to request reset" });
  }
});

/**
 * @swagger
 * /api/auth/password-reset/admin:
 *   post:
 *     summary: Admin resets password using resetToken
 *     tags: [Auth]
 */
router.post("/auth/password-reset/admin", requireAdmin, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const token = String(req.body?.resetToken || "").trim();
    const newPassword = String(req.body?.newPassword || "");

    if (!email || (!isEmailFormat(email) && !isAdminLoginId(email))) {
      return res.status(400).json({ error: "Invalid email" });
    }
    if (!token) {
      return res.status(400).json({ error: "Missing resetToken" });
    }

    const passwordHash = await hashPassword(newPassword);
    const user = await consumePasswordResetTokenAndSetPassword({
      email,
      token,
      passwordHash,
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid resetToken" });
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Failed to reset" });
  }
});

module.exports = router;
