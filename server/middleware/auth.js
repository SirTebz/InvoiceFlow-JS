const crypto = require("crypto");
const { getDb } = require("../database/db");

const COOKIE_NAME = "invoiceflow_session";
const SESSION_DAYS = 14;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
  };
}

function readCookie(req, name) {
  const cookies = req.headers.cookie || "";
  const match = cookies.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function createSession(res, userId) {
  const db = getDb();
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)").run(userId, hashToken(token), expires);
  res.cookie(COOKIE_NAME, token, cookieOptions());
}

function destroySession(req, res) {
  const token = readCookie(req, COOKIE_NAME);
  if (token) getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

function attachUser(req, _res, next) {
  const token = readCookie(req, COOKIE_NAME);
  req.user = null;
  if (!token) return next();
  const row = getDb().prepare(`
    SELECT users.id, users.name, users.email
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > datetime('now')
  `).get(hashToken(token));
  if (row) req.user = row;
  return next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: { message: "Please log in to continue." } });
  return next();
}

module.exports = { createSession, destroySession, attachUser, requireAuth };
