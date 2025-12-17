# Auth (JWT) + Admin Password Reset

This Node server uses MongoDB (`mongodb` driver) and now supports basic JWT auth with an **admin-assisted password reset** flow (no email sending).

## Environment variables

Set these in your shell or `.env` (if you use one):

- `MONGO_URI` (optional) — default `mongodb://localhost:27017/`
- `DB_NAME` (optional) — default `capstone`
- `JWT_SECRET` (**required in production**) — secret used to sign/verify JWT access tokens
- `JWT_EXPIRES_IN` (optional) — default `7d`
- `ADMIN_RESET_KEY` (**required in production**) — admin key for password reset admin endpoint
- `BCRYPT_COST` (optional) — default `10`

### Dev fallback defaults (when env is missing)

For local development convenience, if these env vars are not set and `NODE_ENV !== "production"`, the server falls back to:

- `JWT_SECRET=dev-jwt-secret-change-me`
- `ADMIN_RESET_KEY=dev-admin-reset-key-change-me`

Do not rely on these defaults in production.

## Endpoints

### Register
`POST /api/auth/register`

Body:
- `email`
- `password` (min 8 chars)

Returns:
- `token` (JWT)
- `user`

### Login
`POST /api/auth/login`

Body:
- `email`
- `password`

Returns:
- `token` (JWT)
- `user`

### Me
`GET /api/auth/me`

Header:
- `Authorization: Bearer <token>`

### Delete account
`DELETE /api/auth/me`

Header:
- `Authorization: Bearer <token>`

## Admin-assisted password reset (no email)

### 1) Request reset token
`POST /api/auth/password-reset/request`

Body:
- `email`

Returns:
- `{ ok: true }` always
- If the account exists, it also returns `resetToken` (so admin can apply it)

Server stores the reset token on the user document (top-level fallback used):

- `passwordResetToken`
- `passwordResetRequestedAt`

(Older docs may also use `passwordReset.resetToken`, but the server matches both.)

### 2) Admin applies password reset
`POST /api/auth/password-reset/admin`

Headers:
- `x-admin-key: <ADMIN_RESET_KEY>`

Body:
- `email`
- `resetToken`
- `newPassword` (min 8 chars)

Returns:
- `{ ok: true }`

## Notes

- This is a minimal auth layer meant for project scoping later (e.g. projects owned by `req.user.id`).
- There is no "logout" endpoint for JWT access tokens; the client deletes the token.
