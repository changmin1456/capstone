/*
  Backfill owner fields for legacy documents.
  - projects: if missing ownerUserId but has owner_id -> copy; else set to admin
  - jobs: same
  - progress: no owner field (linked by job_id), so no direct changes

  Usage (optional):
    node scripts/migrate_owner_fields.js

  Requires Mongo connection env vars consistent with src/db/mongo.js.
*/

const { connectMongo, getDb } = require("../src/db/mongo");
const { ensureAdminUser } = require("../src/db/users");

const PROJECTS_COLLECTION = process.env.PROJECTS_COLLECTION || "projects";
const JOBS_COLLECTION = process.env.JOBS_COLLECTION || "jobs";

async function main() {
  await connectMongo();
  const db = getDb();

  // Ensure admin exists and use it for backfill.
  const admin = await ensureAdminUser({ email: "changmin1456@naver.com", password: "8625" });
  const adminId = String(admin._id);

  const projectsCol = db.collection(PROJECTS_COLLECTION);
  const jobsCol = db.collection(JOBS_COLLECTION);

  // Projects
  const pr = await projectsCol.updateMany(
    { ownerUserId: { $exists: false } },
    [
      {
        $set: {
          ownerUserId: {
            $ifNull: ["$owner_id", adminId],
          },
          owner_id: {
            $ifNull: ["$owner_id", adminId],
          },
        },
      },
    ],
  );

  // Jobs
  const jr = await jobsCol.updateMany(
    { ownerUserId: { $exists: false } },
    [
      {
        $set: {
          ownerUserId: {
            $ifNull: ["$owner_id", adminId],
          },
          owner_id: {
            $ifNull: ["$owner_id", adminId],
          },
        },
      },
    ],
  );

  console.log(JSON.stringify({ ok: true, adminId, projects: pr.modifiedCount, jobs: jr.modifiedCount }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
