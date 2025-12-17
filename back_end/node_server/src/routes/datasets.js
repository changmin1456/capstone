// src/routes/datasets.js
const express = require("express");
const axios = require("axios");
const Busboy = require("busboy");
const path = require("path");
const fs = require("fs").promises;
const { requireAuth } = require("../middleware/auth");
const { isAdmin, requireProjectAccess } = require("../middleware/authz");

const router = express.Router();

// FastAPI server
const FAST_API_BASE = "http://127.0.0.1:8000";

const DATASET_ROOT = path.join(__dirname, "../../../fast_server/datasets");
const DATASET_OWNER_FILE = "dataset.owner.json";

async function writeOwnerMetaForTempUuidFolder(uuidFolderName, req) {
  if (!uuidFolderName) return;
  const dir = path.join(DATASET_ROOT, uuidFolderName);
  const metaPath = path.join(dir, DATASET_OWNER_FILE);
  const now = new Date().toISOString();
  const meta = {
    schema: 1,
    ownerUserId: req.user.id,
    ownerEmail: req.user.email,
    created_at: now,
    updated_at: now,
  };
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

async function readOwnerMetaForAnyPath(p) {
  // p can be .../datasets/<uuid>/extracted or .../datasets/<uuid>
  if (!p || typeof p !== "string") return null;
  const resolved = path.resolve(p);
  const rootResolved = path.resolve(DATASET_ROOT);
  if (!resolved.startsWith(rootResolved + path.sep)) return null;
  let uuidDir = resolved;
  if (path.basename(uuidDir) === "extracted") uuidDir = path.dirname(uuidDir);
  const rel = path.relative(rootResolved, uuidDir);
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length !== 1) return null;
  const metaPath = path.join(rootResolved, parts[0], DATASET_OWNER_FILE);
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function ensureDatasetPathOwner(req, res, datasetPath) {
  if (isAdmin(req)) return true;
  const meta = await readOwnerMetaForAnyPath(datasetPath);
  const ownerUserId = meta?.ownerUserId;
  if (!ownerUserId) return res.status(403).json({ error: "Forbidden" });
  if (String(ownerUserId) !== String(req.user.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return true;
}

function isUnder(parent, child) {
  try {
    const p = path.resolve(parent);
    const c = path.resolve(child);
    if (p === c) return true;
    return c.startsWith(p + path.sep);
  } catch {
    return false;
  }
}

function pickTempUuidDirFromInput({ dataset_path, random_id }) {
  // returns absolute path to DATASET_ROOT/<uuid> or null
  const rootResolved = path.resolve(DATASET_ROOT);

  const byId = typeof random_id === "string" ? random_id.trim() : "";
  if (byId) {
    if (!isTempUuidFolderName(byId)) return null;
    return path.join(rootResolved, byId);
  }

  const byPath = typeof dataset_path === "string" ? dataset_path.trim() : "";
  if (!byPath) return null;

  const resolved = path.resolve(byPath);

  // dataset_path can be:
  // - .../datasets/<uuid>/extracted
  // - .../datasets/<uuid>
  // We only ever delete the <uuid> directory.
  let uuidDir = resolved;
  if (path.basename(uuidDir) === "extracted") uuidDir = path.dirname(uuidDir);

  if (!isUnder(rootResolved, uuidDir)) return null;

  const rel = path.relative(rootResolved, uuidDir);
  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length !== 1) return null;

  const folderName = parts[0];
  if (!isTempUuidFolderName(folderName)) return null;

  return path.join(rootResolved, folderName);
}

async function listDirSafe(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function statSafe(p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

function isTempUuidFolderName(name) {
  // FastAPI uses 10-char sha1 prefix currently.
  return typeof name === "string" && /^[a-f0-9]{10}$/i.test(name);
}

/**
 * @swagger
 * /api/datasets/upload:
 *   post:
 *     summary: Upload dataset zip
 *     tags: [Datasets]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               dataset:
 *                 type: string
 *                 format: binary
 *               project_id:
 *                 type: string
 *               title:
 *                 type: string
 *     responses:
 *       200:
 *         description: Uploaded
 */
router.post("/datasets/upload", requireAuth, async (req, res) => {
  const bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 1024 * 1024 * 1024 } });
  const fields = {};
  let fileInfo = null;
  let fileChunks = [];

  bb.on("field", (name, val) => {
    fields[name] = val;
  });

  bb.on("file", (name, file, info) => {
    fileInfo = { fieldname: name, filename: info.filename, mimeType: info.mimeType };
    file.on("data", (d) => fileChunks.push(d));
  });

  bb.on("error", (err) => {
    res.status(400).json({ error: String(err?.message || err) });
  });

  bb.on("finish", async () => {
    try {
      // If project_id is provided, enforce project ownership.
      if (fields.project_id) {
        req.body = { ...(req.body || {}), project_id: fields.project_id };
        const ok = await new Promise((resolve) => requireProjectAccess(req, res, () => resolve(true)));
        if (ok !== true) return;
      }

      const FormData = require("form-data");
      const form = new FormData();

      // 프론트 계약: dataset(file), project_id, title
      if (fields.project_id) form.append("project_id", fields.project_id);
  if (fields.project_name) form.append("project_name", fields.project_name);
      if (fields.title) form.append("title", fields.title);

      const fileFieldName = fileInfo?.fieldname || "dataset";
      const filename = fileInfo?.filename || "dataset.zip";
      const mimeType = fileInfo?.mimeType || "application/zip";
      form.append(fileFieldName, Buffer.concat(fileChunks), { filename, contentType: mimeType });

      const upstream = await axios.post(`${FAST_API_BASE}/datasets/upload`, form, {
        headers: {
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
      });

      // Tag the temp uuid folder with owner metadata so later report/delete/cancel can be scoped.
      // FastAPI currently returns random_id (10-char) and/or dataset_path.
      try {
        const randomId = upstream.data?.random_id;
        if (typeof randomId === "string" && isTempUuidFolderName(randomId)) {
          await writeOwnerMetaForTempUuidFolder(randomId, req);
        } else if (typeof upstream.data?.dataset_path === "string") {
          const t = pickTempUuidDirFromInput({ dataset_path: upstream.data.dataset_path, random_id: null });
          if (t) {
            const folder = path.basename(t);
            if (isTempUuidFolderName(folder)) await writeOwnerMetaForTempUuidFolder(folder, req);
          }
        }
      } catch (e) {
        // don't fail upload because of meta
      }

      res.status(upstream.status).send(upstream.data);
    } catch (err) {
      res.status(500).json({ error: err?.message || "datasets upload failed" });
    }
  });

  req.pipe(bb);
});

/**
 * @swagger
 * /api/datasets/analyze:
 *   post:
 *     summary: Analyze dataset zip
 *     tags: [Datasets]
 */
router.post("/datasets/analyze", requireAuth, async (req, res) => {
  const bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 1024 * 1024 * 1024 } });
  const fields = {};
  let fileInfo = null;
  let fileChunks = [];

  bb.on("field", (name, val) => {
    fields[name] = val;
  });

  bb.on("file", (name, file, info) => {
    fileInfo = { fieldname: name, filename: info.filename, mimeType: info.mimeType };
    file.on("data", (d) => fileChunks.push(d));
  });

  bb.on("error", (err) => {
    res.status(400).json({ error: String(err?.message || err) });
  });

  bb.on("finish", async () => {
    try {
      if (fields.project_id) {
        req.body = { ...(req.body || {}), project_id: fields.project_id };
        const ok = await new Promise((resolve) => requireProjectAccess(req, res, () => resolve(true)));
        if (ok !== true) return;
      }

      const FormData = require("form-data");
      const form = new FormData();

      if (fields.project_id) form.append("project_id", fields.project_id);
  if (fields.project_name) form.append("project_name", fields.project_name);
      if (fields.title) form.append("title", fields.title);

      const fileFieldName = fileInfo?.fieldname || "dataset";
      const filename = fileInfo?.filename || "dataset.zip";
      const mimeType = fileInfo?.mimeType || "application/zip";
      form.append(fileFieldName, Buffer.concat(fileChunks), { filename, contentType: mimeType });

      const upstream = await axios.post(`${FAST_API_BASE}/datasets/analyze`, form, {
        headers: {
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
      });

      try {
        const randomId = upstream.data?.random_id;
        if (typeof randomId === "string" && isTempUuidFolderName(randomId)) {
          await writeOwnerMetaForTempUuidFolder(randomId, req);
        } else if (typeof upstream.data?.dataset_path === "string") {
          const t = pickTempUuidDirFromInput({ dataset_path: upstream.data.dataset_path, random_id: null });
          if (t) {
            const folder = path.basename(t);
            if (isTempUuidFolderName(folder)) await writeOwnerMetaForTempUuidFolder(folder, req);
          }
        }
      } catch (e) {
        // ignore
      }

      res.status(upstream.status).send(upstream.data);
    } catch (err) {
      res.status(500).json({ error: err?.message || "datasets analyze failed" });
    }
  });

  req.pipe(bb);
});

/**
 * @swagger
 * /api/datasets/report:
 *   get:
 *     summary: Report dataset from saved path
 *     tags: [Datasets]
 *     parameters:
 *       - in: query
 *         name: path
 *         schema:
 *           type: string
 */
router.get("/datasets/report", requireAuth, async (req, res) => {
  try {
  const ok = await ensureDatasetPathOwner(req, res, req.query?.path);
  if (ok !== true) return;
    const upstream = await axios.get(`${FAST_API_BASE}/datasets/report`, {
      params: req.query,
      validateStatus: () => true,
    });
    res.status(upstream.status).send(upstream.data);
  } catch (err) {
    res.status(500).json({ error: err.message || "datasets report failed" });
  }
});

/**
 * @swagger
 * /api/datasets/delete-path:
 *   post:
 *     summary: Delete dataset path under server datasets root
 *     tags: [Datasets]
 */
router.post("/datasets/delete-path", requireAuth, async (req, res) => {
  try {
  const ok = await ensureDatasetPathOwner(req, res, req.body?.target || req.body?.path);
  if (ok !== true) return;
    const upstream = await axios.post(`${FAST_API_BASE}/datasets/delete-path`, req.body, {
      headers: { "content-type": "application/json" },
      validateStatus: () => true,
    });
    res.status(upstream.status).send(upstream.data);
  } catch (err) {
    res.status(500).json({ error: err.message || "datasets delete-path failed" });
  }
});

/**
 * @swagger
 * /api/datasets/cancel:
 *   post:
 *     summary: Cancel dataset upload (delete temp uuid folder)
 *     description: |
 *       업로드/분석으로 생성된 임시 폴더(datasets/<uuid>/...)를 취소 시 정리합니다.
 *       프론트는 upload/analyze 응답의 `dataset_path`(extracted 경로) 또는 `random_id`만 보내면 됩니다.
 *     tags: [Datasets]
 */
router.post("/datasets/cancel", requireAuth, async (req, res) => {
  try {
    const { dataset_path, random_id } = req.body || {};

    const target = pickTempUuidDirFromInput({ dataset_path, random_id });
    if (!target) {
      return res
        .status(400)
        .json({ error: "invalid dataset_path/random_id (only temp uuid folder under datasets root is allowed)" });
    }

  const ok = await ensureDatasetPathOwner(req, res, target);
  if (ok !== true) return;

    const upstream = await axios.post(
      `${FAST_API_BASE}/datasets/delete-path`,
      { target },
      {
        headers: { "content-type": "application/json" },
        validateStatus: () => true,
      }
    );

    return res.status(upstream.status).send(upstream.data);
  } catch (err) {
    return res.status(500).json({ error: err?.message || "datasets cancel failed" });
  }
});

/**
 * @swagger
 * /api/datasets/sweep-temp:
 *   post:
 *     summary: Sweep stale temp dataset folders
 *     description: |
 *       임시 uuid 폴더(datasets/<uuid>/...)가 취소/에러 등으로 남았을 때 정리합니다.
 *       기본은 6시간(21600초)보다 오래된 uuid 폴더만 삭제합니다.
 *     tags: [Datasets]
 */
router.post("/datasets/sweep-temp", requireAuth, async (req, res) => {
  try {
  // Only admin can sweep temp folders globally.
  if (!isAdmin(req)) return res.status(403).json({ error: "Forbidden" });
    const ttlSecondsRaw = req.body?.ttl_seconds;
    const ttlSeconds = Number.isFinite(ttlSecondsRaw) ? ttlSecondsRaw : 21600;
    const ttlMs = Math.max(60, ttlSeconds) * 1000; // min 60s
    const now = Date.now();

    const entries = await listDirSafe(DATASET_ROOT);
    const candidates = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter(isTempUuidFolderName);

    let deleted = 0;
    let kept = 0;
    const details = [];

    for (const name of candidates) {
      const dirPath = path.join(DATASET_ROOT, name);
      const st = await statSafe(dirPath);
      if (!st) continue;

      const ageMs = now - st.mtimeMs;
      if (ageMs < ttlMs) {
        kept++;
        continue;
      }

      // Use the same safe delete in FastAPI
      const upstream = await axios.post(
        `${FAST_API_BASE}/datasets/delete-path`,
        { target: dirPath },
        {
          headers: { "content-type": "application/json" },
          validateStatus: () => true,
        }
      );

      if (upstream.status >= 200 && upstream.status < 300) {
        deleted++;
      }
      details.push({ folder: name, status: upstream.status });
    }

    return res.json({ ok: true, ttl_seconds: ttlSeconds, candidates: candidates.length, deleted, kept, details });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "datasets sweep-temp failed" });
  }
});

module.exports = router;
