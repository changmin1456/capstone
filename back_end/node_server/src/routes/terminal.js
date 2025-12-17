// src/routes/terminal.js
const express = require("express");
const { exec } = require("child_process");

const router = express.Router();

/**
 * SECURITY NOTE:
 * This endpoint is intended for local/dev use only.
 * Do not expose it publicly.
 */

/**
 * @swagger
 * /api/terminal:
 *   post:
 *     summary: Execute a shell command (dev only)
 *     tags: [Terminal]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cmd:
 *                 type: string
 *     responses:
 *       200:
 *         description: Command output
 */
router.post("/terminal", (req, res) => {
  const body = req.body || {};
  // Backward/forward compatibility: accept both { cmd } and { command }
  const cmd = (body.cmd ?? body.command) ? String(body.cmd ?? body.command) : "";
  if (!cmd.trim()) {
    return res.status(400).json({ error: "cmd (or command) is required" });
  }

  // Basic safety guard: block some obviously dangerous patterns
  const lower = cmd.toLowerCase();
  const blocked = [
    "rm -rf /",
    "sudo ",
    ":(){",
  ];
  if (blocked.some((b) => lower.includes(b))) {
    return res.status(403).json({ error: "command blocked" });
  }

  exec(cmd, { timeout: 60_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: error.message, stdout: stdout || "", stderr: stderr || "" });
    }
    res.json({ stdout: stdout || "", stderr: stderr || "" });
  });
});

module.exports = router;
