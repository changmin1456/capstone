// src/routes/jobs.js
const express = require("express");
const axios = require("axios");
const path = require("path");
const fs = require("fs").promises;
const { getDb, toObjectId } = require("../db/mongo");
const { requireAuth } = require("../middleware/auth");
const { isAdmin } = require("../middleware/authz");
const { authHeaders } = require("../utils/forwardAuth");

async function requireJobOwnerOrAdmin(req, res) {
  if (isAdmin(req)) return { ok: true, job: null };
  const jobId = req.params?.id;
  let objectId;
  try {
    objectId = toObjectId(String(jobId));
  } catch {
    return { ok: false, res: res.status(400).json({ error: "invalid job id" }) };
  }
  const db = getDb();
  const jobsCol = db.collection(JOBS_COLLECTION);
  const job = await jobsCol.findOne({ _id: objectId });
  if (!job) return { ok: false, res: res.status(404).json({ error: "job not found" }) };
  const owner = job?.ownerUserId || job?.owner_id;
  if (!owner || String(owner) !== String(req.user.id)) {
    return { ok: false, res: res.status(403).json({ error: "Forbidden" }) };
  }
  return { ok: true, job };
}

const router = express.Router();

// FastAPI 서버 주소
const FAST_API_BASE = process.env.FAST_API_BASE || "http://127.0.0.1:8000";

const JOBS_COLLECTION = process.env.JOBS_COLLECTION || "jobs";
const PROJECTS_COLLECTION = process.env.PROJECTS_COLLECTION || "projects";
const DATASET_ROOT = path.join(__dirname, "../../../fast_server/datasets");
const JOB_META_FILE = "job.meta.json";

async function touchJobUpdatedAt(jobId) {
  try {
    const db = getDb();
    const jobsCol = db.collection(JOBS_COLLECTION);
    const objectId = toObjectId(String(jobId));
    await jobsCol.updateOne({ _id: objectId }, { $set: { updated_at: new Date() } });
  } catch (err) {
    console.warn("touchJobUpdatedAt failed:", err?.message || err);
  }
}

async function touchProjectLastRun(jobId) {
  try {
    const db = getDb();
    const jobsCol = db.collection(JOBS_COLLECTION);
    const projectsCol = db.collection(PROJECTS_COLLECTION);
    const objectId = toObjectId(String(jobId));
    const job = await jobsCol.findOne({ _id: objectId });
    if (!job?.project_id) return;
    const projectId = job.project_id;
    await projectsCol.updateOne(
      { _id: projectId },
      { $set: { last_run_at: new Date() } },
    );
  } catch (err) {
    console.warn("touchProjectLastRun failed:", err?.message || err);
  }
}

async function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

async function writeJobMeta({ jobDir, jobId, jobTitle, projectId }) {
  const metaPath = path.join(jobDir, JOB_META_FILE);
  const now = new Date().toISOString();
  const meta = {
    schema: 1,
    kind: "job",
    job_id: jobId,
    job_name: jobTitle || "",
    project_id: projectId || null,
    job_folder: path.basename(jobDir),
    project_folder: path.basename(path.dirname(jobDir)),
    updated_at: now,
  };
  await writeJsonAtomic(metaPath, meta);
}

function safeFolder(name) {
  return (name || "default")
    .toString()
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .slice(0, 80) || "default";
}

function normalizeDatasetPath(datasetPath) {
  if (!datasetPath) return null;
  if (typeof datasetPath !== "string") return null;
  return datasetPath.trim();
}

function isUuidDatasetPathUnderRoot(datasetPath) {
  // expected: <DATASET_ROOT>/<uuid>/extracted
  // Allow absolute extracted path from FastAPI.
  try {
    const cleaned = normalizeDatasetPath(datasetPath);
    if (!cleaned) return false;
    const resolved = path.resolve(cleaned);
    const rootResolved = path.resolve(DATASET_ROOT);
    if (resolved === rootResolved) return false;
    if (!resolved.startsWith(rootResolved + path.sep)) return false;
    const rel = path.relative(rootResolved, resolved);
    const parts = rel.split(path.sep).filter(Boolean);
    return parts.length === 2 && parts[1] === "extracted";
  } catch {
    return false;
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function moveUuidDatasetToProjectJob({ dataset_path, projectFolder, jobFolder }) {
  const cleaned = normalizeDatasetPath(dataset_path);
  if (!cleaned) throw new Error("invalid dataset_path");

  const extracted = path.resolve(cleaned);
  const uuidDir = path.dirname(extracted); // .../<uuid>
  const targetJobDir = path.join(DATASET_ROOT, projectFolder, jobFolder);
  const targetExtracted = path.join(targetJobDir, "extracted");
  const targetZip = path.join(targetJobDir, "raw.zip");

  await fs.mkdir(path.dirname(targetJobDir), { recursive: true });

  // If already moved, just return.
  if (await exists(targetExtracted)) {
    return { extracted_path: targetExtracted, job_dir: targetJobDir };
  }

  // Ensure we don't overwrite existing target dir.
  if (await exists(targetJobDir)) {
    // create unique suffix
    const unique = `${jobFolder}-${Date.now().toString(36)}`;
    const uniqueDir = path.join(DATASET_ROOT, projectFolder, unique);
    await fs.rename(uuidDir, uniqueDir);
    return { extracted_path: path.join(uniqueDir, "extracted"), job_dir: uniqueDir };
  }

  await fs.rename(uuidDir, targetJobDir);
  // Ensure extracted path exists (should, from upload)
  return { extracted_path: targetExtracted, job_dir: targetJobDir, zip_path: targetZip };
}

async function rmSafeUnderDatasetRoot(targetPath) {
  // Defensive delete: only allow deleting within DATASET_ROOT.
  if (!targetPath || typeof targetPath !== "string") return;
  const resolved = path.resolve(targetPath);
  const rootResolved = path.resolve(DATASET_ROOT);
  if (resolved === rootResolved) return;
  if (!resolved.startsWith(rootResolved + path.sep)) return;
  await fs.rm(resolved, { recursive: true, force: true });
}

function getJobDirFromDatasetPath(datasetPath) {
  // Handles:
  // - <...>/<jobDir>/extracted
  // - <...>/<jobDir>/raw.zip
  // - <...>/<jobDir>/<something>
  if (!datasetPath || typeof datasetPath !== "string") return null;
  const resolved = path.resolve(datasetPath);
  const base = path.basename(resolved).toLowerCase();
  if (base === "extracted") return path.dirname(resolved);
  if (base === "raw.zip") return path.dirname(resolved);
  // If it's a file/dir inside the job dir, return parent.
  return path.dirname(resolved);
}

/**
 * _id -> id 문자열로 바꾸는 헬퍼
 */
function mapJob(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

function isDebug(req) {
  const v = req.query?.debug;
  return v === "1" || v === 1 || v === true || v === "true";
}

/**
 * @swagger
 * /api/jobs:
 *   post:
 *     summary: 학습 Job 생성
 *     description: |
 *       학습 Job을 생성합니다(queued). 내부적으로 FastAPI의 /train 엔드포인트를 호출합니다.
 *       외부 계약은 /api/jobs 만 사용합니다.
 *     tags: [Jobs]
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
 *                 description: 프로젝트 ObjectId 문자열
 *               dataset_path:
 *                 type: string
 *                 description: FastAPI datasets 업로드 결과 extracted 폴더 경로
 *               dataset_name:
 *                 type: string
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               lr:
 *                 type: number
 *               batch_size:
 *                 type: integer
 *               epochs:
 *                 type: integer
 *               optimizer:
 *                 type: string
 *               seed:
 *                 type: integer
 *               model_name:
 *                 type: string
 *               image_size:
 *                 type: integer
 *               search_space:
 *                 type: object
 *     responses:
 *       200:
 *         description: Job 생성 성공
 *       400:
 *         description: 잘못된 요청
 *       404:
 *         description: 프로젝트를 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */
router.post("/jobs", requireAuth, async (req, res) => {
  try {
    const {
      project_id,
      dataset_path,
      dataset_name,
      title,
      description,
      task,
      lr,
      batch_size,
      epochs,
      optimizer,
      seed,
      model_name,
      image_size,
      search_space,
    } = req.body || {};

    if (!project_id || !dataset_path) {
      return res.status(400).json({ error: "project_id and dataset_path are required" });
    }

    // 프로젝트 존재 여부 확인
    const db = getDb();
    const projectsCol = db.collection(PROJECTS_COLLECTION);

    // 1) 기본: project_id는 ObjectId(24 hex)여야 함
    // 2) 예외: 프론트가 project name/title을 실수로 보낸 경우도 있으니 name/title로 한 번 더 찾음
    let project = null;
    try {
      const projectObjectId = toObjectId(project_id);
      project = await projectsCol.findOne({ _id: projectObjectId });
    } catch {
      project = await projectsCol.findOne({
        $or: [{ name: project_id }, { title: project_id }],
      });
    }

  if (!project) {
      return res.status(400).json({
        error:
          `Invalid project_id: '${project_id}'. ` +
          "Send the project's Mongo ObjectId (24-char hex) from /api/projects. " +
          "If you intended to send a project name, make sure the UI passes the actual project id.",
      });
    }

    // Owner scoping: non-admin can only create jobs under their own projects.
    if (!isAdmin(req)) {
      const projectOwner = project?.ownerUserId || project?.owner_id;
      if (!projectOwner || String(projectOwner) !== String(req.user.id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

  // FastAPI에는 실제 ObjectId 문자열을 전달하도록 정규화
  const normalizedProjectId = project._id?.toString?.() || project_id;

    // dataset 경로 규칙:
    // - 업로드 직후: datasets/<uuid>/extracted (FastAPI upload)
    // - job 생성 시점: Node가 datasets/<projectName>/<jobName> 으로 이동 후 그 경로를 전달
  let finalDatasetPath = normalizeDatasetPath(dataset_path);
    const projectFolder = safeFolder(project.name || project.title || normalizedProjectId);
    const jobFolder = safeFolder(title || `job-${Date.now()}`);
    if (finalDatasetPath && isUuidDatasetPathUnderRoot(finalDatasetPath)) {
      const moved = await moveUuidDatasetToProjectJob({
        dataset_path: finalDatasetPath,
        projectFolder,
        jobFolder,
      });
      finalDatasetPath = moved.extracted_path;

      // job meta 파일 생성/갱신(학습 전에 폴더에 남겨두기)
      try {
        await writeJobMeta({
          jobDir: moved.job_dir,
          jobId: "pending",
          jobTitle: title || jobFolder,
          projectId: normalizedProjectId,
        });
      } catch (e) {
        console.warn("Failed to write job meta (pre-train):", e?.message);
      }
    }

    // FastAPI /train으로 프록시 (FastAPI 내부 계약)
    const response = await axios.post(
      `${FAST_API_BASE}/train`,
      {
        project_id: normalizedProjectId,
        dataset_path: finalDatasetPath,
        dataset_name,
        title,
        description,
        task,
        lr,
        batch_size,
        epochs,
        optimizer,
        seed,
        model_name,
        image_size,
        search_space,
      },
      { headers: authHeaders(req) },
    );

    return res.status(response.status).json(response.data);
  } catch (err) {
    console.error("POST /api/jobs error:", err.message);
    if (err.response) {
      const status = err.response.status;
      const errorMessage =
        err.response.data?.detail || err.response.data?.error || "failed to create job";
      return res.status(status).json({
        error: errorMessage,
        status,
        detail: err.response.data?.detail,
        raw: err.response.data,
      });
    }
    return res.status(500).json({ error: "failed to create job: " + err.message });
  }
});

/**
 * @swagger
 * /api/jobs:
 *   get:
 *     summary: Job 리스트 조회
 *     description: 모든 job 리스트를 조회합니다. project_id로 필터링 가능합니다.
 *     tags: [Jobs]
 *     parameters:
 *       - in: query
 *         name: project_id
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job 리스트 조회 성공
 */
router.get("/jobs", requireAuth, async (req, res) => {
  const { project_id } = req.query;

  try {
    const db = getDb();
    const jobsCol = db.collection(JOBS_COLLECTION);

    const filter = {};
    // project_id가 DB에 string 또는 ObjectId로 저장돼 있을 수 있어 둘 다 매칭
    if (project_id) {
      const or = [{ project_id: project_id }];
      try {
        const projectObjectId = toObjectId(project_id);
        or.push({ project_id: projectObjectId });
      } catch {
        // ignore
      }
      filter.$or = or;
    }

    const scopedFilter = isAdmin(req)
      ? filter
      : { $and: [filter, { $or: [{ ownerUserId: req.user.id }, { owner_id: req.user.id }] }] };

    const docs = await jobsCol
      .find(scopedFilter)
      .sort({ created_at: -1 })
      .toArray();

    if (isDebug(req)) {
      return res.json({
        debug: {
          db: db.databaseName,
          collection: JOBS_COLLECTION,
          filter: scopedFilter,
          count: docs.length,
        },
        items: docs.map(mapJob),
      });
    }

    res.json(docs.map(mapJob));
  } catch (err) {
    console.error("GET /api/jobs error:", err.message);
    res.status(500).json({ error: "failed to fetch jobs" });
  }
});

/**
 * @swagger
 * /api/jobs/{id}:
 *   get:
 *     summary: Job 상세 조회
 *     description: 특정 job의 상세 정보를 조회합니다.
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job 상세 조회 성공
 */
router.get("/jobs/:id", requireAuth, async (req, res) => {
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

    const doc = await jobsCol.findOne({ _id: objectId });
    if (!doc) {
      if (isDebug(req)) {
        return res.status(404).json({
          error: "job not found",
          debug: {
            db: db.databaseName,
            collection: JOBS_COLLECTION,
            query: { _id: id },
          },
        });
      }
      return res.status(404).json({ error: "job not found" });
    }

    if (!isAdmin(req)) {
      const owner = doc?.ownerUserId || doc?.owner_id;
      if (!owner || String(owner) !== String(req.user.id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    res.json(mapJob(doc));
  } catch (err) {
    console.error("GET /api/jobs/:id error:", err.message);
    res.status(500).json({ error: "failed to fetch job" });
  }
});

/**
 * @swagger
 * /api/jobs/{id}/start:
 *   post:
 *     tags:
 *       - Jobs
 *     summary: 학습 Job 실행 시작
 *     description: queued 상태의 Job을 실행 시작합니다. FastAPI 서버에서 학습을 실행합니다.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID
 *         example: "691ea157eaf6c76585821303"
 *     responses:
 *       '200':
 *         description: Job 실행 시작 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 job_id:
 *                   type: string
 *                   example: "691ea157eaf6c76585821303"
 *                 status:
 *                   type: string
 *                   example: "starting"
 *                 message:
 *                   type: string
 *                   example: "Job execution started"
 *       '400':
 *         description: 잘못된 요청 (Job이 queued 상태가 아님)
 *       '404':
 *         description: Job을 찾을 수 없음
 *       '500':
 *         description: 서버 오류
 */
router.post("/jobs/:id/start", requireAuth, async (req, res) => {
  try {
    const { id: jobId } = req.params;

  const gate = await requireJobOwnerOrAdmin(req, res);
  if (!gate.ok) return;
    
    // FastAPI /jobs/{id}/start으로 요청 전달 (학습 실행 요청)
    const response = await axios.post(`${FAST_API_BASE}/jobs/${jobId}/start`, null, {
      headers: authHeaders(req),
    });
    
    // FastAPI 응답을 그대로 반환
    await touchJobUpdatedAt(jobId);
    await touchProjectLastRun(jobId);
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Error calling FastAPI /jobs/:id/start:", err.message);
    
    // FastAPI 에러 응답 처리
    if (err.response) {
      const status = err.response.status;
      const errorMessage = err.response.data?.detail || err.response.data?.error || "failed to start job";
      return res.status(status).json({ error: errorMessage });
    }
    
    // 네트워크 에러 등
    res.status(500).json({ error: "failed to start job: " + err.message });
  }
});

/**
 * @swagger
 * /api/jobs/{id}/stop:
 *   post:
 *     summary: 실행 중인 Job 중지
 *     description: running 상태의 Job을 중지합니다. FastAPI 서버에서 학습을 중단합니다.
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Job 중지 요청 성공
 *       400:
 *         description: 잘못된 요청 (Job이 running 상태가 아님)
 *       404:
 *         description: Job을 찾을 수 없음
 */
router.post("/jobs/:id/stop", requireAuth, async (req, res) => {
  try {
    const { id: jobId } = req.params;

  const gate = await requireJobOwnerOrAdmin(req, res);
  if (!gate.ok) return;
    
    // FastAPI /jobs/{id}/stop으로 요청 전달
    const response = await axios.post(`${FAST_API_BASE}/jobs/${jobId}/stop`, null, {
      headers: authHeaders(req),
    });
    
    // FastAPI 응답을 그대로 반환
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Error calling FastAPI /jobs/:id/stop:", err.message);
    
    // FastAPI 에러 응답 처리
    if (err.response) {
      const status = err.response.status;
      const errorMessage = err.response.data?.detail || err.response.data?.error || "failed to stop job";
      return res.status(status).json({ error: errorMessage });
    }
    
    // 네트워크 에러 등
    res.status(500).json({ error: "failed to stop job: " + err.message });
  }
});

router.post("/jobs/:id/pause", requireAuth, async (req, res) => {
  try {
    const { id: jobId } = req.params;

  const gate = await requireJobOwnerOrAdmin(req, res);
  if (!gate.ok) return;
    const response = await axios.post(`${FAST_API_BASE}/jobs/${jobId}/pause`, null, {
      headers: authHeaders(req),
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const errorMessage = err.response.data?.detail || err.response.data?.error || "failed to pause job";
      return res.status(status).json({ error: errorMessage });
    }
    res.status(500).json({ error: "failed to pause job: " + err.message });
  }
});

router.post("/jobs/:id/resume", requireAuth, async (req, res) => {
  try {
    const { id: jobId } = req.params;

  const gate = await requireJobOwnerOrAdmin(req, res);
  if (!gate.ok) return;
    const response = await axios.post(`${FAST_API_BASE}/jobs/${jobId}/resume`, null, {
      headers: authHeaders(req),
    });
    await touchJobUpdatedAt(jobId);
    await touchProjectLastRun(jobId);
    res.status(response.status).json(response.data);
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const errorMessage = err.response.data?.detail || err.response.data?.error || "failed to resume job";
      return res.status(status).json({ error: errorMessage });
    }
    res.status(500).json({ error: "failed to resume job: " + err.message });
  }
});

router.post("/jobs/:id/reset", requireAuth, async (req, res) => {
  try {
    const { id: jobId } = req.params;

  const gate = await requireJobOwnerOrAdmin(req, res);
  if (!gate.ok) return;
    const response = await axios.post(`${FAST_API_BASE}/jobs/${jobId}/reset`, null, {
      headers: authHeaders(req),
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const errorMessage = err.response.data?.detail || err.response.data?.error || "failed to reset job";
      return res.status(status).json({ error: errorMessage });
    }
    res.status(500).json({ error: "failed to reset job: " + err.message });
  }
});

/**
 * @swagger
 * /api/jobs/{id}/lock-dataset:
 *   post:
 *     summary: Lock dataset changes for a job
 *     description: Mark the job as dataset-locked so the UI can prevent dataset_path changes after history save.
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lock saved
 *       400:
 *         description: Invalid job id
 *       404:
 *         description: Job not found
 */
router.post("/jobs/:id/lock-dataset", requireAuth, async (req, res) => {
  const { id } = req.params;

  const gate = await requireJobOwnerOrAdmin(req, res);
  if (!gate.ok) return;

  let objectId;
  try {
    objectId = toObjectId(id);
  } catch {
    return res.status(400).json({ error: "invalid job id" });
  }

  try {
    const db = getDb();
    const jobsCol = db.collection(JOBS_COLLECTION);
    const nowIso = new Date().toISOString();

    const r = await jobsCol.updateOne(
      { _id: objectId },
      { $set: { dataset_locked: true, dataset_locked_at: nowIso } }
    );

    if (r.matchedCount === 0) {
      return res.status(404).json({ error: "job not found" });
    }

    return res.json({ ok: true, job_id: id, dataset_locked: true, dataset_locked_at: nowIso });
  } catch (err) {
    console.error("POST /api/jobs/:id/lock-dataset error:", err.message);
    return res.status(500).json({ error: "failed to lock dataset" });
  }
});

// Deploy(변환) 요청: Node -> FastAPI 프록시
// 프론트는 /api/jobs/:id/deploy 를 호출하므로 여기서 받아 FastAPI로 전달한다.
router.post("/jobs/:id/deploy", requireAuth, async (req, res) => {
  try {
    const { id: jobId } = req.params;
    const target = (req.query?.target || "onnx").toString();

  const gate = await requireJobOwnerOrAdmin(req, res);
  if (!gate.ok) return;

    const response = await axios.post(`${FAST_API_BASE}/jobs/${jobId}/deploy`, null, {
      params: { target },
      headers: authHeaders(req),
    });

    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Error calling FastAPI /jobs/:id/deploy:", err.message);

    if (err.response) {
      const status = err.response.status;
      const errorMessage = err.response.data?.detail || err.response.data?.error || "failed to deploy job";
      return res.status(status).json({ error: errorMessage });
    }

    res.status(500).json({ error: "failed to deploy job: " + err.message });
  }
});

// -------------------------
// XAI: Node -> FastAPI proxy
// -------------------------

router.get("/jobs/:id/xai/sources", requireAuth, async (req, res) => {
  try {
    const { id: jobId } = req.params;

  const gate = await requireJobOwnerOrAdmin(req, res);
  if (!gate.ok) return;
    const response = await axios.get(`${FAST_API_BASE}/jobs/${jobId}/xai/sources`, {
      headers: authHeaders(req),
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const errorMessage = err.response.data?.detail || err.response.data?.error || "failed to load xai sources";
      return res.status(status).json({ error: errorMessage });
    }
    res.status(500).json({ error: "failed to load xai sources: " + err.message });
  }
});

router.get("/jobs/:id/xai/images", requireAuth, async (req, res) => {
  try {
    const { id: jobId } = req.params;
    const { source, limit } = req.query;

  const gate = await requireJobOwnerOrAdmin(req, res);
  if (!gate.ok) return;
    const response = await axios.get(`${FAST_API_BASE}/jobs/${jobId}/xai/images`, {
      params: { source, limit },
      headers: authHeaders(req),
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const errorMessage = err.response.data?.detail || err.response.data?.error || "failed to load xai images";
      return res.status(status).json({ error: errorMessage });
    }
    res.status(500).json({ error: "failed to load xai images: " + err.message });
  }
});

router.post("/jobs/:id/xai/generate", requireAuth, async (req, res) => {
  try {
    const { id: jobId } = req.params;
    const { source, image_id } = req.body || {};

  const gate = await requireJobOwnerOrAdmin(req, res);
  if (!gate.ok) return;
    const response = await axios.post(
      `${FAST_API_BASE}/jobs/${jobId}/xai/generate`,
      {
        source,
        image_id,
      },
      { headers: authHeaders(req) },
    );
    res.status(response.status).json(response.data);
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const errorMessage = err.response.data?.detail || err.response.data?.error || "failed to generate xai";
      return res.status(status).json({ error: errorMessage });
    }
    res.status(500).json({ error: "failed to generate xai: " + err.message });
  }
});

// Frontend uses Node as base URL, so proxy FastAPI static files too.
router.get("/files/:kind/*", requireAuth, async (req, res) => {
  try {
    const { kind } = req.params;
    const rawRemainder = req.params[0] || "";

    // Access control:
    // - admin: allow all
    // - non-admin: only allow files under their job folder (job id must be present in path)
    if (!isAdmin(req)) {
      const m = String(rawRemainder).match(/\b[0-9a-fA-F]{24}\b/);
      const jobId = m ? m[0] : null;
      if (!jobId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const gateReq = { ...req, params: { ...req.params, id: jobId } };
      const gate = await requireJobOwnerOrAdmin(gateReq, res);
      if (!gate.ok) return;
    }

    // Prevent trivial path traversal attempts.
    if (rawRemainder.includes("..")) {
      return res.status(400).json({ error: "invalid path" });
    }

    // Express route params are decoded; axios URL building can break for non-ascii.
    // Normalize by decoding once (safe fallback) then re-encoding each segment.
    let decoded;
    try {
      decoded = decodeURIComponent(rawRemainder);
    } catch {
      decoded = rawRemainder;
    }
    const safeRemainder = decoded
      .split("/")
      .filter((s) => s.length)
      .map((seg) => encodeURIComponent(seg))
      .join("/");

    const upstreamUrl = `${FAST_API_BASE}/files/${encodeURIComponent(kind)}/${safeRemainder}`;

    const response = await axios.get(upstreamUrl, {
      responseType: "arraybuffer",
      validateStatus: () => true,
    });

    res.status(response.status);
    if (response.headers && response.headers["content-type"]) {
      res.setHeader("Content-Type", response.headers["content-type"]);
    }
    res.send(response.data);
  } catch (err) {
    res.status(500).json({ error: "failed to fetch file" });
  }
});

/**
 * @swagger
 * /api/jobs/{id}/restart:
 *   post:
 *     summary: 실패하거나 중지된 Job 재시작
 *     description: failed 또는 stopped 상태의 Job을 재시작합니다. FastAPI 서버에서 학습을 다시 시작합니다.
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Job 재시작 성공
 *       400:
 *         description: 잘못된 요청 (Job이 failed 또는 stopped 상태가 아님)
 *       404:
 *         description: Job을 찾을 수 없음
 */
router.post("/jobs/:id/restart", async (req, res) => {
  try {
    const { id: jobId } = req.params;
    
    // FastAPI /jobs/{id}/restart으로 요청 전달
    const response = await axios.post(`${FAST_API_BASE}/jobs/${jobId}/restart`, null, {
      headers: authHeaders(req),
    });
    
    // FastAPI 응답을 그대로 반환
    await touchJobUpdatedAt(jobId);
    await touchProjectLastRun(jobId);
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("Error calling FastAPI /jobs/:id/restart:", err.message);
    
    // FastAPI 에러 응답 처리
    if (err.response) {
      const status = err.response.status;
      const errorMessage = err.response.data?.detail || err.response.data?.error || "failed to restart job";
      return res.status(status).json({ error: errorMessage });
    }
    
    // 네트워크 에러 등
    res.status(500).json({ error: "failed to restart job: " + err.message });
  }
});

/**
 * @swagger
 * /api/jobs/{id}:
 *   patch:
 *     summary: Job 필드 업데이트 (epochs, title, description, model_name, dataset_path 등)
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               epochs:
 *                 type: integer
 *                 description: 새 epochs 값
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               model_name:
 *                 type: string
 *               dataset_path:
 *                 type: string
 *               dataset_name:
 *                 type: string
 *     responses:
 *       200:
 *         description: 업데이트 성공
 *       400:
 *         description: 잘못된 요청
 *       404:
 *         description: Job을 찾을 수 없음
 */
router.patch("/jobs/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const {
    epochs,
    title,
    description,
    model_name,
    dataset_path,
    dataset_name,
    status,
    lr,
    batch_size,
    optimizer,
    seed,
    image_size,
    search_space,
  } = req.body || {};

  let objectId;
  try {
    objectId = toObjectId(id);
  } catch {
    return res.status(400).json({ error: "invalid job id" });
  }

  if (epochs !== undefined && (!Number.isFinite(epochs) || epochs < 0)) {
    return res.status(400).json({ error: "epochs must be a positive number" });
  }

  if (status !== undefined) {
    if (typeof status !== "string") return res.status(400).json({ error: "status must be a string" });
    const allowed = new Set(["queued", "running", "paused", "stopped", "failed", "done", "success", "completed"]);
    if (!allowed.has(status.toLowerCase())) {
      return res.status(400).json({ error: "invalid status value" });
    }
  }

  // Ownership guard
  const gate = await requireJobOwnerOrAdmin(req, res);
  if (!gate.ok) return;

  try {
    const db = getDb();
    const jobsCol = db.collection(JOBS_COLLECTION);
    const job = await jobsCol.findOne({ _id: objectId });
    if (!job) return res.status(404).json({ error: "job not found" });

    const setFields = { updated_at: new Date() };
    if (epochs !== undefined) {
      setFields["hyperparams.epochs"] = epochs;
      setFields.epochs = epochs;
    }
    if (lr !== undefined && Number.isFinite(lr)) {
      setFields["hyperparams.lr"] = lr;
    }
    if (batch_size !== undefined && Number.isFinite(batch_size)) {
      setFields["hyperparams.batch_size"] = batch_size;
    }
    if (optimizer !== undefined && typeof optimizer === "string") {
      setFields["hyperparams.optimizer"] = optimizer;
    }
    if (seed !== undefined && Number.isFinite(seed)) {
      setFields["hyperparams.seed"] = seed;
    }
    if (image_size !== undefined && Number.isFinite(image_size)) {
      setFields["hyperparams.image_size"] = image_size;
    }
    if (search_space && typeof search_space === "object") {
      setFields["hyperparams.search_space"] = search_space;
    }
    if (typeof title === "string") {
      setFields.title = title;
    }
    if (typeof description === "string") {
      setFields.description = description;
  // 일부 프론트 로직은 description을 hyperparams에서도 읽어올 수 있어 동기화
  setFields["hyperparams.description"] = description;
    }
    if (typeof model_name === "string") {
      setFields["hyperparams.model_name"] = model_name;
      setFields.model = model_name;
    }
    if (typeof dataset_name === "string") {
      setFields.dataset_name = dataset_name;
    }
    if (typeof status === "string") {
      setFields.status = status.toLowerCase();
    }

  // dataset 경로 처리
  // - 제목 변경 시: 기존 job dataset 폴더 rename
  // - dataset 교체(save) 시: temp(uuid) 업로드 경로를 job 폴더로 이동 + 기존 job 폴더 삭제
  const currentDatasetPath = job.dataset_path || (job.hyperparams && job.hyperparams.dataset_path);
  let newDatasetPath = dataset_path || currentDatasetPath;
  const oldDatasetPath = currentDatasetPath;
    const newTitle = typeof title === "string" ? title : job.title;
    const oldTitle = job.title;

    if (oldDatasetPath && oldTitle && newTitle && oldTitle !== newTitle) {
      try {
        const oldDir = path.dirname(oldDatasetPath);
        const parentDir = path.dirname(oldDir);
        const newDir = path.join(parentDir, safeFolder(newTitle));
        await fs.mkdir(parentDir, { recursive: true });
        // 기존 새 폴더가 있다면 먼저 제거
        await fs.rm(newDir, { recursive: true, force: true }).catch(() => {});
        await fs.rename(oldDir, newDir);
        newDatasetPath = path.join(newDir, path.basename(oldDatasetPath));
        setFields.dataset_path = newDatasetPath;
        setFields["hyperparams.dataset_path"] = newDatasetPath;

        // job meta 갱신
        try {
          await writeJobMeta({
            jobDir: newDir,
            jobId: id,
            jobTitle: newTitle,
            projectId: job.project_id,
          });
        } catch (e) {
          console.warn("Failed to write job meta:", e?.message);
        }
      } catch (err) {
        console.warn("dataset folder rename failed:", err.message);
      }
    }

    // dataset_path가 새로 들어온 경우 반영
    if (dataset_path && dataset_path !== currentDatasetPath) {
      // 1) If client passes a temp uuid extracted path, move it into this job folder.
      // 2) Remove previous job dataset folder (raw.zip, extracted, etc).
      try {
        const cleaned = normalizeDatasetPath(dataset_path);
        const jobDir = getJobDirFromDatasetPath(currentDatasetPath || "");
        if (cleaned && isUuidDatasetPathUnderRoot(cleaned) && jobDir) {
          const oldJobDir = jobDir;
          // Move uuid/<...> -> <jobDir> (replace)
          const extracted = path.resolve(cleaned);
          const uuidDir = path.dirname(extracted);
          await fs.mkdir(path.dirname(oldJobDir), { recursive: true });

          // Ensure we don't partially delete if rename fails: move into temp then swap.
          const swapDir = `${oldJobDir}.__swap__${Date.now().toString(36)}`;
          await rmSafeUnderDatasetRoot(swapDir).catch(() => {});

          // If current exists, rename it out of the way.
          if (await exists(oldJobDir)) {
            await fs.rename(oldJobDir, swapDir);
          }

          // Move uploaded uuid dir into place.
          await fs.rename(uuidDir, oldJobDir);

          // Cleanup old content.
          await rmSafeUnderDatasetRoot(swapDir);

          newDatasetPath = path.join(oldJobDir, "extracted");
          setFields.dataset_path = newDatasetPath;
          setFields["hyperparams.dataset_path"] = newDatasetPath;

          // job meta 갱신
          try {
            await writeJobMeta({
              jobDir: oldJobDir,
              jobId: id,
              jobTitle: newTitle,
              projectId: job.project_id,
            });
          } catch (e) {
            console.warn("Failed to write job meta (dataset swap):", e?.message);
          }
        } else if (cleaned) {
          // Fall back: just store the path as-is (legacy behavior)
          setFields.dataset_path = cleaned;
          setFields["hyperparams.dataset_path"] = cleaned;
          newDatasetPath = cleaned;
        }
      } catch (e) {
        console.warn("dataset swap failed:", e?.message);
        // Keep legacy behavior: still set dataset_path so UI isn't blocked.
        if (typeof dataset_path === "string") {
          setFields.dataset_path = dataset_path;
          setFields["hyperparams.dataset_path"] = dataset_path;
          newDatasetPath = dataset_path;
        }
      }
    }

    await jobsCol.updateOne({ _id: objectId }, { $set: setFields });
    const updated = await jobsCol.findOne({ _id: objectId });
    return res.json(mapJob(updated));
  } catch (err) {
    console.error("PATCH /api/jobs/:id error:", err.message);
    return res.status(500).json({ error: "failed to update job" });
  }
});

/**
 * @swagger
 * /api/jobs/{id}:
 *   delete:
 *     summary: Job 삭제
 *     description: Job을 삭제합니다. running 상태의 Job은 삭제할 수 없습니다. force=true일 경우 강제 삭제 가능합니다.
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID
 *       - in: query
 *         name: force
 *         required: false
 *         schema:
 *           type: boolean
 *         description: true일 경우 running 상태의 Job도 강제 삭제
 *     responses:
 *       200:
 *         description: Job 삭제 성공
 *       400:
 *         description: 잘못된 Job ID 형식 또는 running 상태로 삭제 불가
 *       404:
 *         description: Job을 찾을 수 없음
 */
router.delete("/jobs/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { force } = req.query;
    const forceDelete = force === "true" || force === true;

  const gate = await requireJobOwnerOrAdmin(req, res);
  if (!gate.ok) return;

    // Job ID 검증
    let objectId;
    try {
      objectId = toObjectId(id);
    } catch {
      return res.status(400).json({ error: "invalid job id" });
    }

    const db = getDb();
    const jobsCol = db.collection(JOBS_COLLECTION);

    // Job 존재 확인
    const job = await jobsCol.findOne({ _id: objectId });
    if (!job) {
      return res.status(404).json({ error: "job not found" });
    }

    // running 상태의 Job은 삭제 불가 (force=true가 아닌 경우)
    if (job.status === "running" && !forceDelete) {
      return res.status(400).json({
        error: "running 상태의 Job은 삭제할 수 없습니다. 강제 삭제하려면 force=true를 추가하세요.",
        status: job.status,
      });
    }

    // 관련 progress 삭제
    const PROGRESS_COLLECTION = process.env.PROGRESS_COLLECTION || "progress";
    const progressCol = db.collection(PROGRESS_COLLECTION);
    const progressDeleteResult = await progressCol.deleteMany({ job_id: id });

    // XAI 산출물 삭제 (back_end/saved_models/xai/{job_id} + legacy exports/xai/{job_id})
    try {
      const fs = require("fs");
      const path = require("path");
      const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
      const xaiDir = path.join(repoRoot, "back_end", "saved_models", "xai", id);
      const legacyXaiDir = path.join(repoRoot, "back_end", "saved_models", "exports", "xai", id);

      if (fs.existsSync(xaiDir)) {
        fs.rmSync(xaiDir, { recursive: true, force: true });
      }
      if (fs.existsSync(legacyXaiDir)) {
        fs.rmSync(legacyXaiDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn("Failed to delete xai outputs for job", id, e?.message);
    }

    // Job 삭제
    const result = await jobsCol.deleteOne({ _id: objectId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "job not found" });
    }

    // 데이터셋 파일/폴더 정리 (dataset_path가 있는 경우)
    const datasetPath = job.dataset_path || (job.hyperparams && job.hyperparams.dataset_path);
    if (datasetPath && typeof datasetPath === "string") {
      try {
        const targetDir = path.dirname(datasetPath);
        await fetch(`${process.env.API_BASE || "http://localhost:3000"}/api/datasets/delete-path`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target: targetDir }),
        });
      } catch (e) {
        console.warn("Failed to delete dataset path for job", id, e?.message);
      }
    }

    return res.json({
      message: "Job이 삭제되었습니다.",
      job_id: id,
      deleted_progress_count: progressDeleteResult.deletedCount,
    });
  } catch (err) {
    console.error("DELETE /api/jobs/:id error:", err.message);
    return res.status(500).json({ error: "failed to delete job" });
  }
});

module.exports = router;
