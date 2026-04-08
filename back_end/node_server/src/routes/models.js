// src/routes/models.js
const express = require("express");
const axios = require("axios");
const Busboy = require("busboy");
const fs = require("fs").promises;
const path = require("path");
const { requireAuth } = require("../middleware/auth");
const { isAdmin } = require("../middleware/authz");
const { ensureIndexes, upsertModelMeta, listVisibleModelIdsForUser, getModelMeta } = require("../db/models_meta");
const { authHeaders } = require("../utils/forwardAuth");

const router = express.Router();

// FastAPI server
const FAST_API_BASE = "http://127.0.0.1:8000";
const MODELS_DIR = path.join(__dirname, "../../../fast_server/models");

async function listDiskModels() {
  try {
    const entries = await fs.readdir(MODELS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .filter((e) => !e.name.startsWith(".") && e.name.toLowerCase() !== "readme.md")
      .map((e) => ({
        id: path.parse(e.name).name,
        name: path.parse(e.name).name,
        description: `Disk model ${e.name}`,
        category: "custom",
        file_path: path.join(MODELS_DIR, e.name),
        visibility: "public",
        ownerUserId: "admin",
      }));
  } catch {
    return [];
  }
}

/**
 * @swagger
 * /api/models:
 *   get:
 *     summary: 사용 가능한 모델 목록 조회
 *     description: 학습에 사용할 수 있는 모델 목록을 조회합니다.
 *     tags: [Models]
 *     responses:
 *       200:
 *         description: 모델 목록 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     example: "resnet18"
 *                   name:
 *                     type: string
 *                     example: "ResNet-18"
 *                   description:
 *                     type: string
 *                     example: "18-layer ResNet 모델"
 *                   category:
 *                     type: string
 *                     example: "classification"
 */
router.get("/models", requireAuth, async (req, res) => {
  try {
    const upstream = await axios.get(`${FAST_API_BASE}/models`, {
      params: req.query,
      validateStatus: () => true,
      headers: authHeaders(req),
    });

  if (!(upstream.status >= 200 && upstream.status < 300) || !Array.isArray(upstream.data)) {
      return res.status(upstream.status).send(upstream.data);
    }

  let upstreamList = upstream.data;

  // If FastAPI returned empty, fall back to disk scan so uploaded/manual files appear.
  if (!Array.isArray(upstreamList) || upstreamList.length === 0) {
    upstreamList = await listDiskModels();
  }

  // Return combined list directly (avoid DB filtering to ensure visibility even if Mongo is down).
  return res.status(200).send(upstreamList);
  } catch (err) {
    // On error, fall back to disk models so UI can still show something.
    const disk = await listDiskModels();
    if (disk.length > 0) {
      return res.status(200).send(disk);
    }
    return res.status(502).json({
      error: "FastAPI /models unavailable",
      detail: err?.message || String(err),
    });
  }
});

/**
 * @swagger
 * /api/models/{id}:
 *   get:
 *     summary: 특정 모델 정보 조회
 *     description: 모델 ID로 특정 모델의 상세 정보를 조회합니다.
 *     tags: [Models]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: 모델 ID
 *     responses:
 *       200:
 *         description: 모델 정보 조회 성공
 *       404:
 *         description: 모델을 찾을 수 없음
 */
router.get("/models/:id", async (req, res) => {
  const { id } = req.params;

  // FastAPI는 단건 조회를 제공하지 않아서 list에서 찾아줌
  try {
    const upstream = await axios.get(`${FAST_API_BASE}/models`, {
      validateStatus: () => true,
      headers: authHeaders(req),
    });
    if (upstream.status >= 200 && upstream.status < 300 && Array.isArray(upstream.data)) {
      const found = upstream.data.find((m) => m.id === id);
      if (!found) return res.status(404).json({ error: "Model not found" });
      return res.json(found);
    }
  } catch (_) {
    // ignore and fallback below
  }

  // Fallback to disk models
  const disk = await listDiskModels();
  const foundDisk = disk.find((m) => m.id === id);
  if (foundDisk) return res.json(foundDisk);
  return res.status(404).json({ error: "Model not found" });
});

/**
 * @swagger
 * /api/models:
 *   post:
 *     summary: Upload model file
 *     tags: [Models]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               category:
 *                 type: string
 *     responses:
 *       200:
 *         description: Uploaded
 */
router.post("/models", requireAuth, async (req, res) => {
  // NOTE: Express req stream을 axios에 그대로 넘기면 multipart boundary/stream 처리가 깨지는 경우가 많아서
  // busboy로 파싱 -> FastAPI로 다시 multipart 업로드합니다.
  const bb = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 50 * 1024 * 1024 } });

  const fields = {};
  let fileBufferChunks = [];
  let fileInfo = null;

  bb.on("field", (name, val) => {
    fields[name] = val;
  });

  bb.on("file", (name, file, info) => {
    fileInfo = { fieldname: name, filename: info.filename, mimeType: info.mimeType };
    file.on("data", (d) => fileBufferChunks.push(d));
    file.on("limit", () => {
      // fileSize limit reached
    });
  });

  bb.on("error", (err) => {
    res.status(400).json({ error: String(err?.message || err) });
  });

  bb.on("finish", async () => {
    try {
      const FormData = require("form-data");
      const form = new FormData();

      // 프론트 계약: id, name, model_file
      if (fields.id) form.append("id", fields.id);
      if (fields.name) form.append("name", fields.name);
      if (fields.description) form.append("description", fields.description);
      if (fields.category) form.append("category", fields.category);

      const fileFieldName = fileInfo?.fieldname || "model_file";
      const filename = fileInfo?.filename || "model.py";
      const mimeType = fileInfo?.mimeType || "application/octet-stream";
      const buf = Buffer.concat(fileBufferChunks);
      form.append(fileFieldName, buf, { filename, contentType: mimeType });

      const upstream = await axios.post(`${FAST_API_BASE}/models`, form, {
        headers: {
          ...form.getHeaders(),
          ...authHeaders(req),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
      });

      // Persist meta for visibility enforcement.
      try {
        await ensureIndexes();
        const returnedId = upstream.data?.id;
        const modelId = returnedId || fields.id || fields.model_id || fields.name;
        if (modelId) {
          await upsertModelMeta({
            modelId: String(modelId),
            ownerUserId: req.user.id,
            visibility: isAdmin(req) ? "public" : "private",
            name: fields.name,
            description: fields.description,
            category: fields.category,
          });
        }
      } catch (_) {
        // don't fail upload
      }

      res.status(upstream.status).send(upstream.data);
    } catch (err) {
      res.status(500).json({ error: err?.message || "models upload failed" });
    }
  });

  req.pipe(bb);
});

/**
 * @swagger
 * /api/models/{id}:
 *   delete:
 *     summary: Delete model by id
 *     tags: [Models]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
router.delete("/models/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  // Only admin or owner can delete a model when meta exists.
  try {
    await ensureIndexes();
    const meta = await require("../db/models_meta").getModelMeta(id);
    if (meta && !isAdmin(req) && String(meta.ownerUserId) !== String(req.user.id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  } catch {
    // ignore meta errors; fall back to upstream behavior
  }

  try {
    const upstream = await axios.delete(`${FAST_API_BASE}/models/${encodeURIComponent(id)}`, {
      validateStatus: () => true,
      headers: authHeaders(req),
    });
    res.status(upstream.status).send(upstream.data);
  } catch (err) {
    res.status(500).json({ error: err.message || "models delete failed" });
  }
});

module.exports = router;
