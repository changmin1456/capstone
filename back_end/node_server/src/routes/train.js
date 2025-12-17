// src/routes/train.js
const express = require("express");
const axios = require("axios");
const { getDb, toObjectId } = require("../db/mongo");

const router = express.Router();

// FastAPI 서버 주소 
const FAST_API_BASE = "http://127.0.0.1:8000";

const PROJECTS_COLLECTION = process.env.PROJECTS_COLLECTION || "projects";

/**
 * @swagger
 * /api/train:
 *   post:
 *     summary: 학습 Job 생성
 *     description: |
 *       학습 Job을 생성합니다. Job은 "queued" 상태로 생성되며, 실행은 별도 엔드포인트(/api/jobs/{id}/start)에서 시작해야 합니다.
 *       FastAPI /train으로 요청을 프록시합니다.
 *     tags: [Train]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - project_id
 *               - dataset_path
 *             properties:
 *               project_id:
 *                 type: string
 *                 description: 프로젝트 ID
 *                 example: "my-project"
 *               dataset_path:
 *                 type: string
 *                 description: 데이터셋 파일/디렉토리 경로
 *                 example: "/path/to/dataset"
 *               lr:
 *                 type: number
 *                 description: Learning rate
 *                 default: 0.001
 *                 example: 0.001
 *               batch_size:
 *                 type: integer
 *                 description: Batch size
 *                 default: 32
 *                 example: 32
 *               epochs:
 *                 type: integer
 *                 description: Epoch 수
 *                 default: 10
 *                 example: 10
 *               optimizer:
 *                 type: string
 *                 description: Optimizer 이름
 *                 default: "adam"
 *                 example: "adam"
 *               seed:
 *                 type: integer
 *                 description: 랜덤 시드
 *                 default: 42
 *                 example: 42
 *               model_name:
 *                 type: string
 *                 description: "모델 이름 (예: resnet18, vgg16)"
 *                 example: "resnet18"
 *     responses:
 *       200:
 *         description: 학습 Job 생성 성공 (status는 queued)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 job_id:
 *                   type: string
 *                   description: 생성된 Job ID (실행 시 사용)
 *                   example: "691e6b1bb2efdd8cd348655a"
 *                 status:
 *                   type: string
 *                   description: Job 상태 (항상 "queued")
 *                   example: "queued"
 *       400:
 *         description: 잘못된 요청
 *       500:
 *         description: 서버 오류
 */
router.post("/train", async (req, res) => {
  try {
    // 요청 body 검증
    const { project_id, dataset_path, lr, batch_size, epochs, optimizer, seed, model_name } = req.body;
    
    if (!project_id || !dataset_path) {
      return res.status(400).json({ 
        error: "project_id and dataset_path are required" 
      });
    }

    // 프로젝트 존재 여부 확인
    const db = getDb();
    let projectObjectId;
    try {
      projectObjectId = toObjectId(project_id);
    } catch {
      return res.status(400).json({ 
        error: `Invalid project_id format: '${project_id}'. ObjectId must be a 24-character hex string.` 
      });
    }

    const project = await db.collection(PROJECTS_COLLECTION).findOne({ _id: projectObjectId });
    if (!project) {
      return res.status(404).json({ 
        error: `Project not found: '${project_id}'` 
      });
    }

    // FastAPI /train으로 요청 전달
    const response = await axios.post(`${FAST_API_BASE}/train`, {
      project_id,
      dataset_path,
      lr: lr || 1e-3,
      batch_size: batch_size || 32,
      epochs: epochs || 10,
      optimizer: optimizer || "adam",
      seed: seed || 42,
      model_name: model_name || "resnet18",
    });

    // FastAPI 응답을 그대로 반환
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Error calling FastAPI /train:", err.message);
    
    // FastAPI 에러 응답 처리
    if (err.response) {
      const status = err.response.status;
      const errorMessage = err.response.data?.detail || err.response.data?.error || "failed to call train";
      return res.status(status).json({ error: errorMessage });
    }
    
    // 네트워크 에러 등
    res.status(500).json({ error: "failed to call train: " + err.message });
  }
});

/**
 * @swagger
 * /api/train:
 *   get:
 *     summary: (Alias) 학습 Job 조회
 *     description: |
 *       프론트에서 train 네임스페이스로 job 목록을 조회하는 케이스를 위한 별칭입니다.
 *       내부적으로는 /api/jobs 와 동일한 동작을 합니다.
 *     tags: [Train]
 *     parameters:
 *       - in: query
 *         name: project_id
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job 리스트
 */
router.get("/train", async (req, res) => {
  try {
    const { project_id } = req.query;
  const debug = req.query?.debug === "1" || req.query?.debug === 1 || req.query?.debug === true || req.query?.debug === "true";

    const db = getDb();
    const jobsCol = db.collection(process.env.JOBS_COLLECTION || "jobs");

    const filter = {};
    if (project_id) {
      // FastAPI stores `project_id` as ObjectId. Accept either:
      // 1) 24-hex string (ObjectId) -> query by ObjectId
      // 2) legacy string project_id -> query by string
      // To be safe, if it *looks* like ObjectId, query with $in.
      try {
        const projectObjectId = toObjectId(project_id);
        filter.project_id = { $in: [projectObjectId, project_id] };
      } catch {
        filter.project_id = project_id;
      }
    }

    const docs = await jobsCol.find(filter).sort({ created_at: -1 }).toArray();
    const mapped = docs.map(({ _id, ...rest }) => ({
      id: _id.toString(),
      ...rest,
    }));

    if (debug) {
      return res.json({
        debug: {
          project_id_query: project_id ?? null,
          filter,
          matched: mapped.length,
        },
        data: mapped,
      });
    }

    res.json(mapped);
  } catch (err) {
    console.error("GET /api/train (alias) error:", err.message);
    res.status(500).json({ error: "failed to fetch train jobs" });
  }
});

/**
 * @swagger
 * /api/train/{id}:
 *   delete:
 *     summary: (Alias) 학습 Job 삭제
 *     description: |
 *       프론트에서 train 네임스페이스로 삭제하는 케이스를 위한 별칭입니다.
 *       내부적으로는 /api/jobs/{id} 삭제 규칙과 동일합니다.
 *     tags: [Train]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: force
 *         required: false
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: 삭제 성공
 */
router.delete("/train/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { force } = req.query;
    const forceDelete = force === "true" || force === true;

    let objectId;
    try {
      objectId = toObjectId(id);
    } catch {
      return res.status(400).json({ error: "invalid job id" });
    }

    const db = getDb();
    const jobsCol = db.collection(process.env.JOBS_COLLECTION || "jobs");
    const job = await jobsCol.findOne({ _id: objectId });
    if (!job) return res.status(404).json({ error: "job not found" });

    if (job.status === "running" && !forceDelete) {
      return res.status(400).json({
        error: "running 상태의 Job은 삭제할 수 없습니다. 강제 삭제하려면 force=true를 추가하세요.",
        status: job.status,
      });
    }

    const progressCol = db.collection(process.env.PROGRESS_COLLECTION || "progress");
    const progressDeleteResult = await progressCol.deleteMany({ job_id: id });
    const result = await jobsCol.deleteOne({ _id: objectId });
    if (result.deletedCount === 0) return res.status(404).json({ error: "job not found" });

    return res.json({
      message: "Job이 삭제되었습니다.",
      job_id: id,
      deleted_progress_count: progressDeleteResult.deletedCount,
    });
  } catch (err) {
    console.error("DELETE /api/train/:id (alias) error:", err.message);
    res.status(500).json({ error: "failed to delete train job" });
  }
});

module.exports = router;

