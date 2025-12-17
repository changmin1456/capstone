// src/routes/projects.js
const express = require("express");
const { getDb, toObjectId } = require("../db/mongo");
const path = require("path");
const fs = require("fs").promises;
const { requireAuth } = require("../middleware/auth");
const { isAdmin, requireProjectAccess } = require("../middleware/authz");

const router = express.Router();

const PROJECTS_COLLECTION =
  process.env.PROJECTS_COLLECTION || "projects";
const DATASET_ROOT = path.join(__dirname, "../../../fast_server/datasets");

const PROJECT_META_FILE = "project.meta.json";

async function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

async function writeProjectMeta({ folderName, projectId, name, description }) {
  const dir = path.join(DATASET_ROOT, folderName);
  await fs.mkdir(dir, { recursive: true });
  const metaPath = path.join(dir, PROJECT_META_FILE);
  const now = new Date().toISOString();
  const meta = {
    schema: 1,
    kind: "project",
    project_id: projectId,
    project_name: name || "",
    description: description || "",
    project_folder: folderName,
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

/**
 * _id -> id 문자열로 바꾸는 헬퍼
 */
function mapProject(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

/**
 * @swagger
 * /api/projects:
 *   post:
 *     summary: 프로젝트 생성
 *     tags: [Projects]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: 생성 성공
 */
router.post("/projects", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const { name, description, owner_id } = req.body || {};

    if (!name || typeof name !== "string") {
      return res
        .status(400)
        .json({ message: "name은 필수입니다." });
    }

    const trimmedName = name.trim();
    const duplicate = await db
      .collection(PROJECTS_COLLECTION)
      .findOne({ name: { $regex: `^${trimmedName}$`, $options: "i" } });

    if (duplicate) {
      return res.status(409).json({ message: "이미 같은 이름의 프로젝트가 있습니다." });
    }

    const now = new Date();
    const doc = {
      name: trimmedName,
      description: (description || "").trim(),
  // New: enforce owner scoping by authenticated user.
  ownerUserId: req.user.id,
  // Legacy: keep for backward compatibility / existing code.
  owner_id: owner_id || req.user.id,
      created_at: now,
      updated_at: now,
    };

    const result = await db
      .collection(PROJECTS_COLLECTION)
      .insertOne(doc);

    const created = mapProject({ _id: result.insertedId, ...doc });

    // datasets/<프로젝트명>/project.meta.json 생성
    try {
      const folderName = safeFolder(created.name || created.id);
      await writeProjectMeta({
        folderName,
        projectId: created.id,
        name: created.name,
        description: created.description,
      });
    } catch (e) {
      console.warn("Failed to write project meta:", e?.message);
    }

    return res.status(201).json(created);
  } catch (err) {
    console.error("POST /projects error:", err);
    return res
      .status(500)
      .json({ message: "프로젝트 생성 중 오류가 발생했습니다." });
  }
});

/**
 * @swagger
 * /api/projects:
 *   get:
 *     summary: 프로젝트 리스트 조회
 *     tags: [Projects]
 *     responses:
 *       200:
 *         description: 프로젝트 리스트
 */
router.get("/projects", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const col = db.collection(PROJECTS_COLLECTION);

    // 나중에 owner_id 기준 필터링 가능
    const filter = isAdmin(req)
      ? {}
      : {
          $or: [{ ownerUserId: req.user.id }, { owner_id: req.user.id }],
        };
    const docs = await col.find(filter).sort({ created_at: -1 }).toArray();
    return res.json(docs.map(mapProject));
  } catch (err) {
    console.error("GET /projects error:", err);
    return res
      .status(500)
      .json({ message: "오류가 발생했습니다." });
  }
});

/**
 * @swagger
 * /api/projects/{id}:
 *   get:
 *     summary: 프로젝트 단일 조회
 *     tags: [Projects]
 */
router.get("/projects/:id", requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const db = getDb();
    const col = db.collection(PROJECTS_COLLECTION);
    const { id } = req.params;

    let _id;
    try {
      _id = toObjectId(id);
    } catch {
      return res.status(400).json({ message: "잘못된 형식입니다." });
    }

    const doc = await col.findOne({ _id });
    if (!doc) {
      return res.status(404).json({ message: "프로젝트를 찾을 수 없습니다." });
    }

    return res.json(mapProject(doc));
  } catch (err) {
    console.error("GET /projects/:id error:", err);
    return res
      .status(500)
      .json({ message: "오류가 발생했습니다." });
  }
});

/**
 * @swagger
 * /api/projects/{id}:
 *   patch:
 *     summary: 프로젝트 수정 (name, description)
 *     tags: [Projects]
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
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: 수정 성공
 *       400:
 *         description: 잘못된 요청
 *       404:
 *         description: 프로젝트를 찾을 수 없음
 */
router.patch("/projects/:id", requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const db = getDb();
    const col = db.collection(PROJECTS_COLLECTION);
    const { id } = req.params;
    const { name, description } = req.body || {};

    let _id;
    try {
      _id = toObjectId(id);
    } catch {
      return res.status(400).json({ message: "잘못된 형식입니다." });
    }

  const setFields = {};
    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "name은 비어있을 수 없습니다." });
      }
      setFields.name = name.trim();
    }
    if (description !== undefined) {
      if (typeof description !== "string") {
        return res.status(400).json({ message: "description 형식이 올바르지 않습니다." });
      }
      setFields.description = description.trim();
    }

    if (Object.keys(setFields).length === 0) {
      return res.status(400).json({ message: "수정할 필드가 없습니다." });
    }

    setFields.updated_at = new Date();

    const existing = await col.findOne({ _id });
    if (!existing) {
      return res.status(404).json({ message: "프로젝트를 찾을 수 없습니다." });
    }

    // name 변경 시 중복 체크(대소문자 무시)
    if (setFields.name && setFields.name !== existing.name) {
      const duplicate = await col.findOne({
        _id: { $ne: _id },
        name: { $regex: `^${setFields.name}$`, $options: "i" },
      });
      if (duplicate) {
        return res.status(409).json({ message: "이미 같은 이름의 프로젝트가 있습니다." });
      }

      // 프로젝트 이름 기반으로 datasets/<프로젝트명>/... 폴더를 운영하므로,
      // 이름 변경 시 datasets 폴더도 함께 rename 한다.
      // (폴더 이동 실패 시 DB만 바뀌는 상황을 막기 위해 rename을 먼저 시도)
      const oldFolderName = safeFolder(existing.name || id);
      const newFolderName = safeFolder(setFields.name);
      if (oldFolderName && newFolderName && oldFolderName !== newFolderName) {
        const oldDir = path.join(DATASET_ROOT, oldFolderName);
        const newDir = path.join(DATASET_ROOT, newFolderName);

        try {
          const [oldStat, newStat] = await Promise.all([
            fs.stat(oldDir).catch(() => null),
            fs.stat(newDir).catch(() => null),
          ]);

          // oldDir이 있고, newDir이 없을 때만 rename
          if (oldStat && !newStat) {
            await fs.rename(oldDir, newDir);
          }

          // newDir이 이미 있으면 충돌로 간주
          if (newStat) {
            return res.status(409).json({
              message: "새 프로젝트 이름에 해당하는 dataset 폴더가 이미 존재합니다.",
            });
          }
        } catch (e) {
          console.warn("dataset folder rename failed:", e?.message);
          return res.status(500).json({
            message: "프로젝트 이름 변경 중 dataset 폴더 이동에 실패했습니다.",
          });
        }
      }
    }

    await col.updateOne({ _id }, { $set: setFields });
    const updated = await col.findOne({ _id });

    // meta 갱신 (이름 변경/설명 변경 시)
    try {
      const folderName = safeFolder((setFields.name || updated.name) || id);
      await writeProjectMeta({
        folderName,
        projectId: id,
        name: updated.name,
        description: updated.description,
      });
    } catch (e) {
      console.warn("Failed to update project meta:", e?.message);
    }

    return res.json(mapProject(updated));
  } catch (err) {
    console.error("PATCH /projects/:id error:", err);
    return res.status(500).json({ message: "오류가 발생했습니다." });
  }
});

/**
 * @swagger
 * /api/projects/{id}/jobs:
 *   get:
 *     summary: 프로젝트의 Job 목록 조회
 *     description: 특정 프로젝트에 속한 모든 Job을 조회합니다.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 프로젝트 ID
 *     responses:
 *       200:
 *         description: Job 목록 조회 성공
 *       400:
 *         description: 잘못된 프로젝트 ID 형식
 *       404:
 *         description: 프로젝트를 찾을 수 없음
 */
router.get("/projects/:id/jobs", requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;

    // 프로젝트 존재 확인
    let projectId;
    try {
      projectId = toObjectId(id);
    } catch {
      return res.status(400).json({ message: "잘못된 프로젝트 ID 형식입니다." });
    }

    const project = await db.collection(PROJECTS_COLLECTION).findOne({ _id: projectId });
    if (!project) {
      return res.status(404).json({ message: "프로젝트를 찾을 수 없습니다." });
    }

    // 프로젝트의 Job 목록 조회
    const JOBS_COLLECTION = process.env.JOBS_COLLECTION || "jobs";
    const jobsCol = db.collection(JOBS_COLLECTION);

    // jobs.project_id can be stored as either string or ObjectId depending on
    // which endpoint created it. Match both to avoid empty lists.
    const projectFilter = { $or: [{ project_id: id }, { project_id: projectId }] };

    const jobs = await jobsCol
      .find(projectFilter)
      .sort({ created_at: -1 })
      .toArray();

    // _id를 id로 변환
    const mappedJobs = jobs.map((job) => {
      const { _id, ...rest } = job;
      return { id: _id.toString(), ...rest };
    });

    return res.json({
      project_id: id,
      project_name: project.name,
      jobs: mappedJobs,
      count: mappedJobs.length,
    });
  } catch (err) {
    console.error("GET /projects/:id/jobs error:", err);
    return res.status(500).json({ message: "오류가 발생했습니다." });
  }
});

/**
 * @swagger
 * /api/projects/{id}:
 *   delete:
 *     summary: 프로젝트 삭제
 *     description: 프로젝트를 삭제합니다. force=true일 경우 관련 Job도 함께 삭제됩니다.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 프로젝트 ID
 *       - in: query
 *         name: force
 *         required: false
 *         schema:
 *           type: boolean
 *         description: true일 경우 관련 Job도 함께 삭제
 *     responses:
 *       200:
 *         description: 프로젝트 삭제 성공
 *       400:
 *         description: 잘못된 프로젝트 ID 형식 또는 관련 Job이 있어서 삭제 불가
 *       404:
 *         description: 프로젝트를 찾을 수 없음
 */
router.delete("/projects/:id", requireAuth, requireProjectAccess, async (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { force } = req.query;
    const forceDelete = force === "true" || force === true;

    // 프로젝트 존재 확인
    let projectId;
    try {
      projectId = toObjectId(id);
    } catch {
      return res.status(400).json({ message: "잘못된 프로젝트 ID 형식입니다." });
    }

    const project = await db.collection(PROJECTS_COLLECTION).findOne({ _id: projectId });
    if (!project) {
      return res.status(404).json({ message: "프로젝트를 찾을 수 없습니다." });
    }

    // 프로젝트에 속한 Job 확인
    const JOBS_COLLECTION = process.env.JOBS_COLLECTION || "jobs";
    const jobsCol = db.collection(JOBS_COLLECTION);
  const projectFilter = { $or: [{ project_id: id }, { project_id: projectId }] };
  const jobCount = await jobsCol.countDocuments(projectFilter);

    if (jobCount > 0 && !forceDelete) {
      return res.status(400).json({
        message: `프로젝트에 ${jobCount}개의 Job이 있습니다. 관련 Job도 함께 삭제하려면 force=true를 추가하세요.`,
        job_count: jobCount,
      });
    }

    // force=true일 경우 관련 Job도 삭제
    if (forceDelete && jobCount > 0) {
      // 관련 progress도 삭제
      const PROGRESS_COLLECTION = process.env.PROGRESS_COLLECTION || "progress";
      const progressCol = db.collection(PROGRESS_COLLECTION);
      
      // 프로젝트의 모든 Job ID 가져오기
  const jobs = await jobsCol.find(projectFilter).toArray();
      const jobIds = jobs.map((job) => job._id.toString());

      // 각 Job의 progress 삭제
      if (jobIds.length > 0) {
        await progressCol.deleteMany({ job_id: { $in: jobIds } });
      }

      // Job 삭제
  await jobsCol.deleteMany(projectFilter);
    }

    // 프로젝트 삭제
    const result = await db.collection(PROJECTS_COLLECTION).deleteOne({ _id: projectId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "프로젝트를 찾을 수 없습니다." });
    }

    // 데이터셋 폴더 삭제: datasets/<프로젝트명 또는 ID>
    try {
      const folderName = safeFolder(project.name || id);
      const targetDir = path.join(DATASET_ROOT, folderName);
      await fs.rm(targetDir, { recursive: true, force: true });
    } catch (err) {
      console.warn("프로젝트 데이터셋 폴더 삭제 실패:", err.message);
    }

    return res.json({
      message: "프로젝트가 삭제되었습니다.",
      project_id: id,
      deleted_jobs: forceDelete ? jobCount : 0,
    });
  } catch (err) {
    console.error("DELETE /projects/:id error:", err);
    return res.status(500).json({ message: "오류가 발생했습니다." });
  }
});

module.exports = router;
