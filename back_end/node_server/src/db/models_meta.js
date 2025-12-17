const { getDb } = require("./mongo");

function col() {
  return getDb().collection("models_meta");
}

async function ensureIndexes() {
  await col().createIndex({ modelId: 1 }, { unique: true });
  await col().createIndex({ ownerUserId: 1 });
  await col().createIndex({ visibility: 1 });
}

async function upsertModelMeta({ modelId, ownerUserId, visibility, name, description, category }) {
  const now = new Date();
  const doc = {
    modelId: String(modelId),
    ownerUserId: ownerUserId ? String(ownerUserId) : null,
    visibility: visibility || "private", // public|private
    name: name || null,
    description: description || null,
    category: category || null,
    updatedAt: now,
  };
  await col().updateOne(
    { modelId: String(modelId) },
    { $set: doc, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
  return doc;
}

async function getModelMeta(modelId) {
  return col().findOne({ modelId: String(modelId) });
}

async function listVisibleModelIdsForUser({ userId, isAdmin }) {
  if (isAdmin) {
    const docs = await col().find({}, { projection: { modelId: 1 } }).toArray();
    return new Set(docs.map((d) => d.modelId));
  }

  const docs = await col()
    .find(
      {
        $or: [{ visibility: "public" }, { ownerUserId: String(userId) }],
      },
      { projection: { modelId: 1 } },
    )
    .toArray();
  return new Set(docs.map((d) => d.modelId));
}

module.exports = {
  ensureIndexes,
  upsertModelMeta,
  getModelMeta,
  listVisibleModelIdsForUser,
};
