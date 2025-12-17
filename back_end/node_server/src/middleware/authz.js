const { getDb, toObjectId } = require("../db/mongo");

const PROJECTS_COLLECTION = process.env.PROJECTS_COLLECTION || "projects";
const JOBS_COLLECTION = process.env.JOBS_COLLECTION || "jobs";

function isAdmin(req) {
  return req?.user?.role === "admin";
}

function forbid(res) {
  return res.status(403).json({ error: "Forbidden" });
}

async function loadProjectById(projectId) {
  const db = getDb();
  const col = db.collection(PROJECTS_COLLECTION);
  const _id = toObjectId(String(projectId));
  return col.findOne({ _id });
}

async function loadJobById(jobId) {
  const db = getDb();
  const col = db.collection(JOBS_COLLECTION);
  const _id = toObjectId(String(jobId));
  return col.findOne({ _id });
}

function getOwnerIdFromDoc(doc) {
  // Support both new field and legacy field.
  return (
    doc?.ownerUserId ||
    doc?.owner_id ||
    doc?.ownerId ||
    null
  );
}

function canAccessOwnerScopedDoc(req, doc) {
  if (isAdmin(req)) return true;
  const ownerId = getOwnerIdFromDoc(doc);
  return ownerId && String(ownerId) === String(req.user.id);
}

async function requireProjectAccess(req, res, next) {
  if (isAdmin(req)) return next();
  try {
    const projectId = req.params?.id || req.params?.projectId || req.body?.project_id || req.body?.projectId;
    if (!projectId) return forbid(res);
    const project = await loadProjectById(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!canAccessOwnerScopedDoc(req, project)) return forbid(res);
    req.project = project;
    return next();
  } catch (e) {
    return res.status(400).json({ error: "Invalid project id" });
  }
}

async function requireJobAccess(req, res, next) {
  if (isAdmin(req)) return next();
  try {
    const jobId = req.params?.id || req.params?.jobId || req.params?.job_id || req.body?.job_id || req.body?.jobId;
    if (!jobId) return forbid(res);
    const job = await loadJobById(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (!canAccessOwnerScopedDoc(req, job)) return forbid(res);
    req.job = job;
    return next();
  } catch (e) {
    return res.status(400).json({ error: "Invalid job id" });
  }
}

module.exports = {
  isAdmin,
  canAccessOwnerScopedDoc,
  requireProjectAccess,
  requireJobAccess,
};
