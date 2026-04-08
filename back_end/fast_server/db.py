"""
Lightweight Mongo connection helpers shared across FastAPI endpoints.

The original FastAPI sources were lost; this file reconstructs the minimal
pieces needed by the restored endpoints. It mirrors the Node server's defaults
so both services read/write the same collections.
"""

from functools import lru_cache
from typing import Optional
import os

from bson import ObjectId
from pymongo import MongoClient


MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")


def _normalize_db_name(name: Optional[str]) -> str:
    if not name:
        return "capstone"
    n = str(name).strip()
    # Project historically had a "capston" typo; normalize to the canonical name.
    if n == "capston":
        return "capstone"
    return n


DB_NAME = _normalize_db_name(os.environ.get("DB_NAME"))


@lru_cache()
def _client() -> MongoClient:
    return MongoClient(MONGO_URI)


def get_db():
    return _client()[DB_NAME]


def to_object_id(value: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise ValueError("Invalid ObjectId")
    return ObjectId(value)


# Convenience collection handles (match Node server defaults)
db = get_db()
jobs_col = db["jobs"]
progress_col = db["progress"]
projects_col = db["projects"]
datasets_col = db["datasets"]
experiments_col = db["experiments"]
models_meta_col = db["models_meta"]
users_col = db["users"]
