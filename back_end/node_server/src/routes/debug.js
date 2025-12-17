// src/routes/debug.js
const express = require("express");

const router = express.Router();

function maskMongoUri(uri) {
  if (!uri) return uri;
  try {
    if (uri.includes("@") && uri.includes("://")) {
      const [scheme, rest] = uri.split("://");
      const idx = rest.indexOf("@");
      if (idx !== -1) {
        const creds = rest.slice(0, idx);
        const host = rest.slice(idx + 1);
        if (creds.includes(":")) {
          return `${scheme}://***:***@${host}`;
        }
      }
    }
    return uri;
  } catch {
    return "<unparseable>";
  }
}

/**
 * @swagger
 * /api/debug/mongo:
 *   get:
 *     summary: Mongo 연결 설정 디버그 (dev)
 *     tags: [Debug]
 *     responses:
 *       200:
 *         description: 현재 Mongo URI/DB/컬렉션 설정
 */
router.get("/debug/mongo", (req, res) => {
  const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/";
  let DB_NAME = process.env.DB_NAME || "capstone";
  if (String(DB_NAME).trim() === "capston") DB_NAME = "capstone";

  res.json({
    mongo_uri: maskMongoUri(MONGO_URI),
    db_name: DB_NAME,
    jobs_collection: process.env.JOBS_COLLECTION || "jobs",
    progress_collection: process.env.PROGRESS_COLLECTION || "progress",
    projects_collection: process.env.PROJECTS_COLLECTION || "projects",
    models_collection: process.env.MODELS_COLLECTION || "models",
  });
});

module.exports = router;
