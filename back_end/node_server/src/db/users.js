const { getDb, toObjectId } = require("./mongo");
const { hashPassword } = require("../utils/password");
const bcrypt = require("bcryptjs");

function col() {
  return getDb().collection("users");
}

async function ensureIndexes() {
  await col().createIndex({ email: 1 }, { unique: true });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function findByEmail(email) {
  const norm = normalizeEmail(email);
  if (!norm) return null;
  return col().findOne({ email: norm });
}

async function findById(id) {
  return col().findOne({ _id: toObjectId(String(id)) });
}

async function createUser({ email, passwordHash }) {
  const now = new Date();
  const doc = {
    email: normalizeEmail(email),
    passwordHash,
    role: "user",
    createdAt: now,
    updatedAt: now,
  // for admin reset flows (keep it simple / queryable)
  passwordResetToken: null,
  passwordResetRequestedAt: null,
  };
  const r = await col().insertOne(doc);
  return { ...doc, _id: r.insertedId };
}

async function setRoleById(id, role) {
  const now = new Date();
  await col().updateOne(
    { _id: toObjectId(String(id)) },
    { $set: { role: String(role), updatedAt: now } },
  );
}

async function ensureAdminUser({ email, password }) {
  await ensureIndexes();
  const normEmail = normalizeEmail(email);
  if (!normEmail) throw new Error("Missing admin email");
  if (!password) throw new Error("Missing admin password");

  const existing = await findByEmail(normEmail);
  if (existing) {
    if (existing.role !== "admin") {
      await setRoleById(existing._id, "admin");
    }
    return { ...existing, role: "admin" };
  }

  // NOTE: The fixed admin password is intentionally short (e.g. "admin").
  // Keep normal user password rules (>= 8) in `hashPassword`, but allow
  // this bootstrap path to set the admin password via bcrypt directly.
  const cost = Number(process.env.BCRYPT_COST || 10);
  const passwordHash = await bcrypt.hash(String(password), cost);
  const created = await createUser({ email: normEmail, passwordHash });
  await setRoleById(created._id, "admin");
  return { ...created, role: "admin" };
}

async function deleteUserById(id) {
  return col().deleteOne({ _id: toObjectId(String(id)) });
}

async function setPasswordHashById(id, passwordHash) {
  const now = new Date();
  await col().updateOne(
    { _id: toObjectId(String(id)) },
    {
      $set: {
        passwordHash,
        updatedAt: now,
        passwordResetToken: null,
        passwordResetRequestedAt: null,
      },
      // Backward-compat for older docs
      $unset: { passwordReset: "" },
    },
  );
}

async function createPasswordResetRequestByEmail(email) {
  const user = await findByEmail(email);
  if (!user) return null;
  const now = new Date();
  const token = cryptoRandomToken();
  await col().updateOne(
    { _id: user._id },
    {
      // Store both nested and top-level fields for compatibility.
      $set: {
        passwordReset: { requestedAt: now, resetToken: token },
        passwordResetRequestedAt: now,
        passwordResetToken: token,
      },
    },
  );
  return { userId: String(user._id), token, requestedAt: now };
}

async function consumePasswordResetTokenAndSetPassword({ email, token, passwordHash }) {
  const norm = normalizeEmail(email);
  const now = new Date();

  const updated = await col().findOneAndUpdate(
    {
      email: norm,
      $or: [
        { "passwordReset.resetToken": String(token) },
        { passwordResetToken: String(token) },
      ],
    },
    {
      $set: {
        passwordHash,
        updatedAt: now,
        passwordResetToken: null,
        passwordResetRequestedAt: null,
      },
  // Backward-compat for older docs
  $unset: { passwordReset: "" },
    },
    { returnDocument: "after" },
  );

  // mongodb driver v7 can return the updated document directly (not { value }).
  if (!updated) return null;
  if (updated.value) return updated.value;
  if (updated.lastErrorObject && updated.lastErrorObject.n === 0) return null;
  return updated; // document
}

function cryptoRandomToken() {
  const crypto = require("crypto");
  return crypto.randomBytes(24).toString("hex");
}

module.exports = {
  ensureIndexes,
  normalizeEmail,
  findByEmail,
  findById,
  createUser,
  setRoleById,
  ensureAdminUser,
  deleteUserById,
  setPasswordHashById,
  createPasswordResetRequestByEmail,
  consumePasswordResetTokenAndSetPassword,
};
