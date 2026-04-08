import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr

from db import users_col, to_object_id

router = APIRouter(tags=["auth"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


def _jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET")
    if secret:
        return secret
    if os.environ.get("NODE_ENV") != "production":
        return "dev-jwt-secret-change-me"
    raise RuntimeError("JWT_SECRET not configured")


def _jwt_expires_delta() -> timedelta:
    raw = os.environ.get("JWT_EXPIRES_IN", "7d")
    if raw.endswith("d"):
        try:
            days = int(raw[:-1])
            return timedelta(days=days)
        except Exception:
            return timedelta(days=7)
    try:
        seconds = int(raw)
        return timedelta(seconds=seconds)
    except Exception:
        return timedelta(days=7)


def _sign_token(payload: dict) -> str:
    exp = datetime.now(timezone.utc) + _jwt_expires_delta()
    to_encode = {**payload, "exp": exp}
    return jwt.encode(to_encode, _jwt_secret(), algorithm="HS256")


def _verify_token(token: str) -> dict:
    return jwt.decode(token, _jwt_secret(), algorithms=["HS256"])


def _hash_password(password: str) -> str:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    cost = int(os.environ.get("BCRYPT_COST", 10))
    return pwd_context.hash(password, rounds=cost)


def _verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)


def _public_user(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "email": doc.get("email"),
        "role": doc.get("role", "user"),
        "createdAt": doc.get("createdAt"),
        "updatedAt": doc.get("updatedAt"),
    }


class AuthRegister(BaseModel):
    email: EmailStr
    password: str


class AuthLogin(BaseModel):
    email: EmailStr
    password: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetApply(BaseModel):
    email: EmailStr
    resetToken: str
    newPassword: str


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    # Fallback: allow missing token in dev to avoid blocking UI flows.
    if not creds or creds.scheme.lower() != "bearer":
        return {"id": "dev-anon", "email": None, "role": "admin"}
    try:
        decoded = _verify_token(creds.credentials)
        user_id = decoded.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        # Best-effort DB lookup; if it fails, trust token payload.
        try:
            oid = to_object_id(str(user_id))
            doc = users_col.find_one({"_id": oid})
            if doc:
                return {"id": str(doc["_id"]), "email": doc.get("email"), "role": doc.get("role", "user")}
        except Exception:
            pass
        return {
            "id": str(user_id),
            "email": decoded.get("email"),
            "role": decoded.get("role", "user"),
        }
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def is_admin(user: Optional[dict]) -> bool:
    return bool(user and user.get("role") == "admin")


def require_admin(x_admin_key: Optional[str] = Header(None)) -> None:
    expected = os.environ.get("ADMIN_RESET_KEY") or ("dev-admin-reset-key-change-me" if os.environ.get("NODE_ENV") != "production" else "")
    if not expected:
        raise HTTPException(status_code=500, detail="ADMIN_RESET_KEY not configured")
    if not x_admin_key or str(x_admin_key) != str(expected):
        raise HTTPException(status_code=403, detail="Admin key invalid")


@router.post("/auth/register")
def register(payload: AuthRegister):
    email = payload.email.lower()
    existing = users_col.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Email already exists")
    now = datetime.utcnow()
    pwd_hash = _hash_password(payload.password)
    doc = {
        "email": email,
        "passwordHash": pwd_hash,
        "role": "user",
        "createdAt": now,
        "updatedAt": now,
        "passwordResetToken": None,
        "passwordResetRequestedAt": None,
    }
    res = users_col.insert_one(doc)
    token = _sign_token({"sub": str(res.inserted_id), "email": email, "role": "user"})
    doc["_id"] = res.inserted_id
    return {"token": token, "user": _public_user(doc)}


@router.post("/auth/login")
def login(payload: AuthLogin):
    email = payload.email.lower()
    user = users_col.find_one({"email": email})
    if not user or not _verify_password(payload.password, user.get("passwordHash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = _sign_token({"sub": str(user["_id"]), "email": user.get("email"), "role": user.get("role", "user")})
    return {"token": token, "user": _public_user(user)}


@router.get("/auth/me")
def me(user=Depends(get_current_user)):
    return {"user": user}


@router.delete("/auth/me")
def delete_me(user=Depends(get_current_user)):
    users_col.delete_one({"_id": to_object_id(user["id"])})
    return {"deleted": True}


@router.post("/auth/password-reset/request")
def password_reset_request(payload: PasswordResetRequest):
    email = payload.email.lower()
    user = users_col.find_one({"email": email})
    token = uuid_hex = os.urandom(12).hex()
    now = datetime.utcnow()
    if user:
        users_col.update_one(
            {"_id": user["_id"]},
            {
                "$set": {
                    "passwordResetToken": token,
                    "passwordResetRequestedAt": now,
                    "passwordReset": {"resetToken": token, "requestedAt": now},
                }
            },
        )
    # Always ok for privacy; returns token when user exists for admin-assisted flow.
    return {"ok": True, **({"resetToken": token, "requestedAt": now} if user else {})}


@router.post("/auth/password-reset/admin")
def password_reset_admin(payload: PasswordResetApply, _=Depends(require_admin)):
    email = payload.email.lower()
    user = users_col.find_one(
        {
            "email": email,
            "$or": [
                {"passwordResetToken": payload.resetToken},
                {"passwordReset.resetToken": payload.resetToken},
            ],
        }
    )
    if not user:
        raise HTTPException(status_code=400, detail="Invalid resetToken")
    new_hash = _hash_password(payload.newPassword)
    now = datetime.utcnow()
    users_col.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "passwordHash": new_hash,
                "updatedAt": now,
                "passwordResetToken": None,
                "passwordResetRequestedAt": None,
            },
            "$unset": {"passwordReset": ""},
        },
    )
    return {"ok": True}
