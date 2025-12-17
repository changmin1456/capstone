// src/index.js
// Entry point: connect to Mongo, then start the configured Express app from ./app.

const app = require("./app");
const { connectMongo } = require("./db/mongo");
const { ensureAdminUser } = require("./db/users");

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    try {
      await connectMongo();

      // Seed / enforce the fixed admin account.
      // NOTE: This runs only when Mongo is connected.
      await ensureAdminUser({
        email: "changmin1456@naver.com",
        password: "8625",
      });
    } catch (mongoErr) {
      // Dev-friendly: allow Node to boot even if Mongo isn't up yet.
      console.warn(
  "[33m[1m[0m MongoDB not connected. Some endpoints may fail until Mongo is available.",
      );
      console.warn(mongoErr?.message || mongoErr);
    }

    const server = app.listen(PORT, () => {
      console.log(`Node API server running on http://localhost:${PORT}`);
      console.log(`Swagger docs available at http://localhost:${PORT}/api-docs`);
    });

    server.on("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        console.error(`\n❌ Port ${PORT} is already in use.`);
        console.error(`Fix (macOS): lsof -ti:${PORT} | xargs kill -9`);
        console.error(`Or: PORT=3001 npm run start`);
        process.exit(1);
      }
      console.error("Server error:", err);
      process.exit(1);
    });
  } catch (err) {
    console.error("Failed to start server:", err?.message || err);
    process.exit(1);
  }
}

startServer();

