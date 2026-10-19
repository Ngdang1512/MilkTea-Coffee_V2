import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { pool } from "./database.js";

const SESSION_SECONDS = 8 * 60 * 60;

function sign(value) {
  return createHmac("sha256", config.authSecret).update(value).digest("base64url");
}

export function createToken(account) {
  const payload = Buffer.from(JSON.stringify({
    sub: String(account.id),
    role: account.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function decodeToken(token) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.sub || !Number.isSafeInteger(data.exp) || data.exp <= Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export async function authenticate(request) {
  const authorization = request.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = decodeToken(match[1]);
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT id, ten_dang_nhap AS "tenDangNhap", vai_tro AS role, trang_thai AS status
       FROM tai_khoan WHERE id = $1`,
    [token.sub]
  );
  const account = rows[0];
  if (!account || account.status !== "active" || account.role !== token.role) return null;
  return account;
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}
