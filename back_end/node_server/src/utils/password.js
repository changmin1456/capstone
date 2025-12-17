const bcrypt = require("bcryptjs");

const DEFAULT_COST = 10;

async function hashPassword(plain) {
  const password = String(plain || "");
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  const cost = Number(process.env.BCRYPT_COST || DEFAULT_COST);
  const salt = await bcrypt.genSalt(cost);
  return bcrypt.hash(password, salt);
}

async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(String(plain), String(hash));
}

module.exports = {
  hashPassword,
  verifyPassword,
};
