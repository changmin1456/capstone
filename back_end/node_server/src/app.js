// src/app.js
const path = require("path");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

// 라우터들
const jobsRouter = require("./routes/jobs");
const jobDetailRouter = require("./routes/job_detail");
const progressRouter = require("./routes/progress");
const projectsRouter = require("./routes/projects");
const modelsRouter = require("./routes/models");
const datasetsRouter = require("./routes/datasets");
const experimentsRouter = require("./routes/experiments");
const verifyRouter = require("./routes/verify");
const terminalRouter = require("./routes/terminal");
const authRouter = require("./routes/auth");

const app = express();

// Swagger 설정
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Node API Server",
      version: "1.0.0",
      description: "Node.js API Server for Capston Project (FastAPI Proxy)",
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Development server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Paste token from /api/auth/login or /api/auth/register",
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: [
    path.join(__dirname, "routes", "*.js"),  // routes 폴더의 모든 파일
    path.join(__dirname, "app.js"),          // app.js (ping 엔드포인트)
  ], // Swagger 주석이 있는 파일 경로
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// 미들웨어
app.use(cors());
app.use(bodyParser.json());

// Swagger UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// 헬스 체크용
/**
 * @swagger
 * /api/ping:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server is running
 *         content:
 *           application/json:
 *             example:
 *               message: "node api ok"
 */
app.get("/api/ping", (req, res) => {
  res.json({ message: "node api ok" });
});

// 라우터 등록 (FastAPI 감싸기)
app.use("/api", jobsRouter);
app.use("/api", jobDetailRouter);
app.use("/api", progressRouter);
app.use("/api", projectsRouter);
app.use("/api", modelsRouter);
app.use("/api", datasetsRouter);
app.use("/api", experimentsRouter);
app.use("/api", verifyRouter);
app.use("/api", terminalRouter);
app.use("/api", authRouter);

module.exports = app;
