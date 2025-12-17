// src/routes/verify.js
const express = require("express");
const axios = require("axios");

const router = express.Router();
const FAST_API_BASE = "http://127.0.0.1:8000";

/**
 * @swagger
 * /api/verify/scan:
 *   get:
 *     summary: Scan projects and rebuild verify index
 *     tags: [Verify]
 *     parameters:
 *       - in: query
 *         name: root
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional root path to scan (server-side)
 *     responses:
 *       200:
 *         description: Scan completed
 */
router.get("/verify/scan", async (req, res) => {
	try {
		const upstream = await axios.get(`${FAST_API_BASE}/verify/scan`, {
			params: req.query,
			validateStatus: () => true,
		});
		res.status(upstream.status).send(upstream.data);
	} catch (err) {
		if (err.response) {
			return res
				.status(err.response.status)
				.json({ error: err.response.data?.detail || err.response.data || "verify scan failed" });
		}
		res.status(500).json({ error: err.message || "verify scan failed" });
	}
});

module.exports = router;

