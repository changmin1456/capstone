// src/routes/experiments.js
const express = require("express");
const axios = require("axios");

const router = express.Router();

const FAST_API_BASE = "http://127.0.0.1:8000";

/**
 * @swagger
 * /api/experiments:
 *   get:
 *     summary: List experiments
 *     tags: [Experiments]
 *     parameters:
 *       - in: query
 *         name: job_id
 *         schema:
 *           type: string
 *   post:
 *     summary: Create experiment record
 *     tags: [Experiments]
 */
router.get("/experiments", async (req, res) => {
  try {
    const upstream = await axios.get(`${FAST_API_BASE}/experiments`, {
      params: req.query,
      validateStatus: () => true,
    });
    res.status(upstream.status).send(upstream.data);
  } catch (err) {
    res.status(500).json({ error: err.message || "experiments list failed" });
  }
});

router.post("/experiments", async (req, res) => {
  try {
    const upstream = await axios.post(`${FAST_API_BASE}/experiments`, req.body, {
      headers: { "content-type": "application/json" },
      validateStatus: () => true,
    });
    res.status(upstream.status).send(upstream.data);
  } catch (err) {
    res.status(500).json({ error: err.message || "experiments create failed" });
  }
});

/**
 * @swagger
 * /api/experiments/{id}:
 *   get:
 *     summary: Get experiment
 *     tags: [Experiments]
 *   delete:
 *     summary: Delete experiment
 *     tags: [Experiments]
 */
router.get("/experiments/:id", async (req, res) => {
  try {
    const upstream = await axios.get(`${FAST_API_BASE}/experiments/${encodeURIComponent(req.params.id)}`, {
      validateStatus: () => true,
    });
    res.status(upstream.status).send(upstream.data);
  } catch (err) {
    res.status(500).json({ error: err.message || "experiments get failed" });
  }
});

router.delete("/experiments/:id", async (req, res) => {
  try {
    const upstream = await axios.delete(`${FAST_API_BASE}/experiments/${encodeURIComponent(req.params.id)}`, {
      validateStatus: () => true,
    });
    res.status(upstream.status).send(upstream.data);
  } catch (err) {
    res.status(500).json({ error: err.message || "experiments delete failed" });
  }
});

module.exports = router;
