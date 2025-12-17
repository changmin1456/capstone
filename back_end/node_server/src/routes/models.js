// src/routes/models.js
const express = require("express");
const axios = require("axios");
const Busboy = require("busboy");
const { requireAuth } = require("../middleware/auth");
const { isAdmin } = require("../middleware/authz");
const { ensureIndexes, upsertModelMeta, listVisibleModelIdsForUser, getModelMeta } = require("../db/models_meta");

const router = express.Router();

// FastAPI server
const FAST_API_BASE = "http://127.0.0.1:8000";

/**
 * 사용 가능한 모델 목록
 * AI 파트에서 만든 모델을 여기에 추가하세요.
 * 
 * 모델 파일 위치: back_end/fast_server/models/
 */
const AVAILABLE_MODELS = [
  // 기본 모델들
  {
    id: "resnet18",
    name: "ResNet-18",
    description: "18-layer ResNet 모델",
    category: "classification",
    file_path: null, // 기본 모델은 파일 경로 없음
  },
  {
    id: "resnet34",
    name: "ResNet-34",
    description: "34-layer ResNet 모델",
    category: "classification",
    file_path: null,
  },
  {
    id: "resnet50",
    name: "ResNet-50",
    description: "50-layer ResNet 모델",
    category: "classification",
    file_path: null,
  },
  {
    id: "vgg16",
    name: "VGG-16",
    description: "16-layer VGG 모델",
    category: "classification",
    file_path: null,
  },
  {
    id: "vgg19",
    name: "VGG-19",
    description: "19-layer VGG 모델",
    category: "classification",
    file_path: null,
  },
  {
    id: "mobilenet_v2",
    name: "MobileNet V2",
    description: "MobileNet V2 경량 모델",
    category: "classification",
    file_path: null,
  },
  {
    id: "efficientnet_b0",
    name: "EfficientNet-B0",
    description: "EfficientNet-B0 모델",
    category: "classification",
    file_path: null,
  },
  
  // AI 파트에서 만든 모델들 (예시 - 실제 모델 정보로 교체하세요)
  {
    id: "custom_model_1",
    name: "커스텀 모델 1",
    description: "AI 파트에서 만든 첫 번째 모델",
    category: "custom",
    file_path: "models/custom_model_1.py", // back_end/fast_server/models/ 기준 상대 경로
    weights_path: "models/custom_model_1_weights.pth", // 가중치 파일 경로 (선택사항)
  },
  {
    id: "custom_model_2",
    name: "커스텀 모델 2",
    description: "AI 파트에서 만든 두 번째 모델",
    category: "custom",
    file_path: "models/custom_model_2.py",
    weights_path: "models/custom_model_2_weights.pth",
  },
  {
    id: "custom_model_3",
    name: "커스텀 모델 3",
    description: "AI 파트에서 만든 세 번째 모델",
    category: "custom",
    file_path: "models/custom_model_3.py",
    weights_path: "models/custom_model_3_weights.pth",
  },
];

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
    });

  if (!(upstream.status >= 200 && upstream.status < 300) || !Array.isArray(upstream.data)) {
      return res.status(upstream.status).send(upstream.data);
    }

  // If FastAPI returns an empty list (common when the upstream isn't configured to expose built-ins),
  // merge in our baseline models so the UI still has something to show.
  const upstreamList = upstream.data;
  const combined = upstreamList.length === 0 ? AVAILABLE_MODELS : upstreamList;

    await ensureIndexes();
    const visible = await listVisibleModelIdsForUser({ userId: req.user.id, isAdmin: isAdmin(req) });

    // If meta doesn't exist yet, treat as public (to avoid breaking existing baseline models).
    // We'll only enforce private for models that have explicit meta.
    const filtered = [];
  for (const m of combined) {
      if (!m?.id) continue;
      const id = String(m.id);
      if (visible.has(id)) {
        filtered.push(m);
        continue;
      }

      // allow through if no meta exists (legacy models)
      // eslint-disable-next-line no-await-in-loop
      const meta = await getModelMeta(id);
      if (!meta) filtered.push(m);
    }

    return res.status(200).send(filtered);
  } catch (err) {
    // Fallback to baseline models if FastAPI is down.
    try {
      await ensureIndexes();
      const visible = await listVisibleModelIdsForUser({ userId: req.user.id, isAdmin: isAdmin(req) });
      const filtered = [];
      for (const m of AVAILABLE_MODELS) {
        if (!m?.id) continue;
        const id = String(m.id);
        if (visible.has(id)) {
          filtered.push(m);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const meta = await getModelMeta(id);
        if (!meta) filtered.push(m);
      }
      return res.status(200).send(filtered);
    } catch (e2) {
      return res.status(502).json({
        error: "FastAPI /models unavailable",
        detail: err?.message || String(err),
      });
    }
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
    });
    if (upstream.status >= 200 && upstream.status < 300 && Array.isArray(upstream.data)) {
      const found = upstream.data.find((m) => m.id === id);
      if (!found) return res.status(404).json({ error: "Model not found" });
      return res.json(found);
    }
  } catch (_) {
    // ignore and fallback below
  }

  const model = AVAILABLE_MODELS.find((m) => m.id === id);
  if (!model) return res.status(404).json({ error: "Model not found" });
  res.json(model);
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
    });
    res.status(upstream.status).send(upstream.data);
  } catch (err) {
    res.status(500).json({ error: err.message || "models delete failed" });
  }
});

module.exports = router;

