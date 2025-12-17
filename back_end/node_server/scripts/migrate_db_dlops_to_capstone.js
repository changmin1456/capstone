// back_end/node_server/scripts/migrate_db_dlops_to_capstone.js
// Copies collections from dlops -> capstone (MongoDB) using upsert to avoid duplicates.
// Run from back_end/node_server:
//   node scripts/migrate_db_dlops_to_capstone.js

const { MongoClient, ObjectId } = require("mongodb");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/";
const SOURCE_DB = process.env.SOURCE_DB || "dlops";
const TARGET_DB = process.env.TARGET_DB || "capstone";
const COLLECTIONS = (process.env.COLLECTIONS || "projects,jobs,progress,models")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function normalizeId(doc) {
  if (doc && typeof doc._id === "string" && ObjectId.isValid(doc._id)) {
    // Keep as string; converting can cause clashes if source genuinely uses string ids.
  }
  return doc;
}

async function copyCollection(srcDb, dstDb, name) {
  const src = srcDb.collection(name);
  const dst = dstDb.collection(name);

  const cursor = src.find({});
  let n = 0;

  while (await cursor.hasNext()) {
    const doc = normalizeId(await cursor.next());
    if (!doc || doc._id === undefined) continue;

    await dst.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
    n += 1;
  }

  return n;
}

(async () => {
  const client = new MongoClient(MONGO_URI);
  await client.connect();

  const srcDb = client.db(SOURCE_DB);
  const dstDb = client.db(TARGET_DB);

  const results = {};
  for (const name of COLLECTIONS) {
    results[name] = await copyCollection(srcDb, dstDb, name);
  }

  console.log("Migration complete:", {
    mongo: MONGO_URI,
    source: SOURCE_DB,
    target: TARGET_DB,
    copied: results,
  });

  await client.close();
})().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
