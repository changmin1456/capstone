// src/routes/progress.js
const express = require("express");
const { getDb, toObjectId } = require("../db/mongo");
const { ObjectId } = require("mongodb");
const { requireAuth } = require("../middleware/auth");
const { isAdmin } = require("../middleware/authz");
async function getAllowedJobIdsForUser(db, userId) {
  const jobsCol = db.collection(JOBS_COLLECTION);
  const jobs = await jobsCol
    .find({ $or: [{ ownerUserId: userId }, { owner_id: userId }] }, { projection: { _id: 1 } })
    .toArray();
  const ids = jobs.map((j) => String(j._id));
  return new Set(ids);
}

async function ensureCanAccessJobId(req, res, jobId) {
  if (isAdmin(req)) return true;
  const db = getDb();
  let objectId;
  try {
    objectId = toObjectId(String(jobId));
  } catch {
    return res.status(400).json({ error: "invalid job id" });
  }
  const jobsCol = db.collection(JOBS_COLLECTION);
  const job = await jobsCol.findOne({ _id: objectId }, { projection: { ownerUserId: 1, owner_id: 1 } });
  if (!job) return res.status(404).json({ error: "job not found" });
  const owner = job.ownerUserId || job.owner_id;
  if (!owner || String(owner) !== String(req.user.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return true;
}


const router = express.Router();

const PROGRESS_COLLECTION = process.env.PROGRESS_COLLECTION || "progress";
const JOBS_COLLECTION = process.env.JOBS_COLLECTION || "jobs";

function mapDoc(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

function normalizeLogs(logs) {
  if (!Array.isArray(logs)) return logs;
  return logs
    .map((entry) => {
      if (entry && typeof entry === "object") {
        const line = typeof entry.line === "string" ? entry.line : (typeof entry.message === "string" ? entry.message : null);
        if (line) {
          return {
            line,
            run_id: entry.run_id,
            t: entry.t,
          };
        }
      }
      return { line: String(entry) };
    })
    .filter((entry) => entry && typeof entry.line === "string" && entry.line.length);
}

function normalizeProgressDoc(doc) {
  if (!doc || typeof doc !== "object") return doc;
  const mapped = mapDoc(doc);
  if (!mapped) return mapped;
  if (mapped.logs) {
    mapped.logs = normalizeLogs(mapped.logs);
  }
  return mapped;
}

/**
 * @swagger
 * /api/jobs/progress:
 *   get:
 *     summary: Progress 리스트 조회
 *     description: 모든 job의 progress 정보를 조회합니다. job_id, project_id로 필터링 가능합니다.
 *     tags: [Progress]
 *     parameters:
 *       - in: query
 *         name: job_id
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: project_id
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Progress 리스트 조회 성공
 */
router.get("/jobs/progress", requireAuth, async (req, res) => {
  const { job_id, project_id } = req.query;

  try {
    const db = getDb();
    const progressCol = db.collection(PROGRESS_COLLECTION);

    const filter = {};
    if (job_id) filter.job_id = job_id;
    if (project_id) filter.project_id = project_id;

    if (!isAdmin(req)) {
      const allowed = await getAllowedJobIdsForUser(db, req.user.id);
      filter.job_id = filter.job_id || { $in: Array.from(allowed) };
      // if job_id provided but not allowed -> empty
      if (typeof filter.job_id === "string" && !allowed.has(filter.job_id)) {
        return res.json([]);
      }
    }

    const docs = await progressCol
      .find(filter)
      .sort({ created_at: -1 })
      .toArray();

    res.json(docs.map(normalizeProgressDoc));
  } catch (err) {
    console.error("GET /api/jobs/progress error:", err.message);
    res.status(500).json({ error: "failed to fetch progress" });
  }
});

/**
 * @swagger
 * /api/jobs/{id}/progress:
 *   get:
 *     summary: 특정 Job의 최신 progress 조회
 *     description: progress 컬렉션에서 job_id에 해당하는 최신 문서를 반환합니다.
 *     tags: [Progress]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: progress 조회 성공
 *       404:
 *         description: progress 문서가 없음
 */
router.get("/jobs/:id/progress", requireAuth, async (req, res) => {
  const { id: jobId } = req.params;

  try {
  const ok = await ensureCanAccessJobId(req, res, jobId);
  if (ok !== true) return;

    const db = getDb();
    const progressCol = db.collection(PROGRESS_COLLECTION);

    let objectId = null;
    try {
      objectId = toObjectId(String(jobId));
    } catch {
      objectId = null;
    }

    let doc = await progressCol.findOne({ job_id: jobId }, { sort: { updated_at: -1, created_at: -1 } });
    if (objectId) {
      const byId = await progressCol.findOne({ _id: objectId });
      if (byId) {
        if (!byId.job_id) {
          await progressCol.updateOne({ _id: objectId }, { $set: { job_id: jobId } });
          byId.job_id = jobId;
        }
        doc = byId;
      } else if (!doc) {
        doc = byId;
      }
    }
    if (!doc) {
      return res.json({
        job_id: jobId,
        status: "queued",
        progress: 0.0,
        epoch: 0,
        total_epochs: 0,
        logs: [],
      });
    }

    return res.json(normalizeProgressDoc(doc));
  } catch (err) {
    console.error("GET /api/jobs/:id/progress error:", err.message);
    return res.status(500).json({ error: "failed to fetch progress" });
  }
});

/**
 * @swagger
 * /api/jobs/{id}/progress:
 *   delete:
 *     summary: 특정 Job의 progress 삭제(초기화)
 *     description: progress 컬렉션에서 job_id에 해당하는 문서를 삭제합니다.
 *     tags: [Progress]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 삭제 성공
 */
router.delete("/jobs/:id/progress", requireAuth, async (req, res) => {
  const { id: jobId } = req.params;

  try {
  const ok = await ensureCanAccessJobId(req, res, jobId);
  if (ok !== true) return;

    const db = getDb();
    const progressCol = db.collection(PROGRESS_COLLECTION);

    const r = await progressCol.deleteMany({ job_id: jobId });
    return res.json({ ok: true, job_id: jobId, deleted_count: r.deletedCount });
  } catch (err) {
    console.error("DELETE /api/jobs/:id/progress error:", err.message);
    return res.status(500).json({ error: "failed to delete progress" });
  }
});

/**
 * @swagger
 * /api/jobs/{id}/progress/stream:
 *   get:
 *     summary: 실시간 Progress SSE 스트리밍 (Change Streams)
 *     description: MongoDB Change Streams를 사용하여 특정 job의 progress를 실시간으로 스트리밍합니다.
 *     tags: [Progress]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: SSE 연결 성공
 */
/**
 * Change Streams 기반 SSE
 * - progress 컬렉션에서 job_id == :id 인 문서 변경만 구독
 * - 새로 insert/update 되면 바로 push
 * - job status가 completed/failed가 되면 종료
 */
router.get("/jobs/:id/progress/stream", requireAuth, async (req, res) => {
  const { id: jobId } = req.params;

  const ok = await ensureCanAccessJobId(req, res, jobId);
  if (ok !== true) return;

  // jobId 유효성 검사
  let objectId;
  try {
    objectId = toObjectId(jobId);
  } catch {
    res.writeHead(400, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
    });
    res.write(
      `data: ${JSON.stringify({ type: "error", message: "invalid job id" })}\n\n`
    );
    return res.end();
  }

  const db = getDb();
  const progressCol = db.collection(PROGRESS_COLLECTION);
  const jobsCol = db.collection(JOBS_COLLECTION);

  // SSE 헤더
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "Cache-Control": "no-cache",
  });

  // 초기 연결 이벤트
  res.write(
    `data: ${JSON.stringify({
      type: "connected",
      job_id: jobId,
    })}\n\n`
  );

  // 1) 현재 job 상태 한 번 보내주기 (선택 사항)
  try {
    const jobDoc = await jobsCol.findOne({ _id: objectId });
    if (jobDoc) {
      res.write(
        `data: ${JSON.stringify({
          type: "snapshot",
          job: mapDoc(jobDoc),
        })}\n\n`
      );
    }
  } catch (e) {
    // jobId 형식 이상해도 그냥 무시 (이미 위에서 connected 보냈으니까)
    console.error("initial job snapshot error:", e.message);
  }

  // 2) Change Stream 파이프라인
  const pipeline = [
    {
      $match: {
        $or: [
          { "fullDocument.job_id": jobId },
          ...(objectId ? [{ "fullDocument._id": objectId }] : []),
        ],
      },
    },
  ];

  let changeStream;
  try {
    changeStream = progressCol.watch(pipeline, {
      fullDocument: "updateLookup",
    });
  } catch (err) {
    console.error("ChangeStream error:", err.message);
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        message: "Change Streams not supported on this MongoDB instance",
      })}\n\n`
    );
    return res.end();
  }

  // change stream 이벤트 리스너
  changeStream.on("change", async (change) => {
    try {
      const doc = change.fullDocument;
      if (!doc) return;

      const payload = {
        type: "progress",
        job_id: jobId,
        progress: doc.progress ?? null,
        epoch: doc.epoch ?? null,
        total_epochs: doc.total_epochs ?? null,
        loss: doc.loss ?? null,
        accuracy: doc.accuracy ?? null,
        status: doc.status ?? null,
        logs: normalizeLogs(doc.logs) || [],
        history: doc.history ?? null,
        train_loss: doc.train_loss ?? null,
        val_loss: doc.val_loss ?? null,
        train_accuracy: doc.train_accuracy ?? null,
        val_accuracy: doc.val_accuracy ?? null,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
      };

      res.write(`data: ${JSON.stringify(payload)}\n\n`);

      // job status가 완료/실패면 스트림 종료
      if (doc.status === "completed" || doc.status === "failed") {
        res.write(
          `data: ${JSON.stringify({
            type: "done",
            job_id: jobId,
            status: doc.status,
          })}\n\n`
        );
        await changeStream.close();
        return res.end();
      }
    } catch (err) {
      console.error("change handler error:", err.message);
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          message: err.message,
        })}\n\n`
      );
    }
  });

  // 에러 처리
  changeStream.on("error", (err) => {
    console.error("ChangeStream error:", err.message);
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        message: "ChangeStream error: " + err.message,
      })}\n\n`
    );
    res.end();
  });

  // 클라이언트가 끊었을 때
  req.on("close", async () => {
    if (changeStream && !changeStream.closed) {
      await changeStream.close();
    }
    res.end();
  });
});

module.exports = router;
