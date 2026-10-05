import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

const SECRET = process.env.SL_SECRET ?? 'smart-living-dev-secret-change-me';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const b64 = (input: Buffer | string) => Buffer.from(input).toString('base64url');

function sign(data: string): string {
  return createHmac('sha256', SECRET).update(data).digest('base64url');
}

export function issueToken(userId: string): string {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({ sub: userId, exp: Date.now() + TOKEN_TTL_MS }));
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

export function verifyToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = sign(`${header}.${payload}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof claims.sub !== 'string') return null;
    if (typeof claims.exp === 'number' && claims.exp < Date.now()) return null;
    return claims.sub;
  } catch {
    return null;
  }
}

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthedRequest, res: import('express').Response, next: import('express').NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const userId = token ? verifyToken(token) : null;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid bearer token.' });
    return;
  }
  req.userId = userId;
  next();
}