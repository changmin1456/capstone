// src/db/mongo.js
const { MongoClient } = require("mongodb");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/";
function normalizeDbName(name) {
  if (!name) return "capstone";
  const n = String(name).trim();
  // Common typo seen in this project history
  if (n === "capston") return "capstone";
  return n;
}

// NOTE: default DB is capstone. If env contains `capston`, normalize it.
const DB_NAME = normalizeDbName(process.env.DB_NAME) || "capstone";

let client = null;
let db = null;

/**
 * MongoDB 연결
 */
async function connectMongo() {
  try {
    if (client) {
      return; // 이미 연결되어 있으면 재연결하지 않음
    }

    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    
    console.log("✓ MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err.message);
    throw err;
  }
}

/**
 * DB 인스턴스 반환
 */
function getDb() {
  if (!db) {
    throw new Error("MongoDB not connected. Call connectMongo() first.");
  }
  return db;
}

/**
 * 문자열을 ObjectId로 변환
 */
function toObjectId(id) {
  const { ObjectId } = require("mongodb");
  if (!ObjectId.isValid(id)) {
    throw new Error("Invalid ObjectId");
  }
  return new ObjectId(id);
}

module.exports = {
  connectMongo,
  getDb,
  toObjectId,
};
