// src/routes/job_detail.js
const express = require("express");
const { getDb, toObjectId } = require("../db/mongo");
const { requireAuth } = require("../middleware/auth");
const { isAdmin } = require("../middleware/authz");

const router = express.Router();

const JOBS_COLLECTION = process.env.JOBS_COLLECTION || "jobs";
const PROGRESS_COLLECTION = process.env.PROGRESS_COLLECTION || "progress";

function mapDoc(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

/**
 * @swagger
 * /api/jobs/{id}/full:
 *   get:
 *     summary: Job 상세 + Progress 통합 조회
 *     description: 특정 job의 상세 정보와 progress 정보를 함께 조회합니다.
 *     tags: [Job Detail]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job 상세 + Progress 조회 성공
 */
router.get("/jobs/:id/full", requireAuth, async (req, res) => {
  const { id } = req.params;

  let objectId;
  try {
    objectId = toObjectId(id);
  } catch {
    return res.status(400).json({ error: "invalid job id" });
  }

  try {
    const db = getDb();
    const jobsCol = db.collection(JOBS_COLLECTION);
    const progressCol = db.collection(PROGRESS_COLLECTION);

    const jobDoc = await jobsCol.findOne({ _id: objectId });
    if (!jobDoc) {
      return res.status(404).json({ error: "job not found" });
    }

    if (!isAdmin(req)) {
      const owner = jobDoc?.ownerUserId || jobDoc?.owner_id;
      if (!owner || String(owner) !== String(req.user.id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    // FastAPI에서 progress.job_id 를 문자열 job_id 로 저장했다고 가정
    const progressDocs = await progressCol
      .find({ job_id: id })
      .sort({ created_at: 1 })
      .toArray();

    res.json({
      job: mapDoc(jobDoc),
      progress: progressDocs.map(mapDoc),
    });
  } catch (err) {
    console.error(
      "GET /api/jobs/:id/full error:",
      err.message
    );
    res.status(500).json({ error: "failed to get full job info" });
  }
});

module.exports = router;
