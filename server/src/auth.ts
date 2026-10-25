import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

// Constant-time comparison so the secret can't be guessed from response timing
export function secretsMatch(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isDeployed(): boolean {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
}

// Every /api route except health and summary needs `Authorization: Bearer <APP_TOKEN>`.
// Without APP_TOKEN the API stays open for local development, but refuses to run deployed.
export function requireAppToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.APP_TOKEN;
  if (!expected) {
    if (isDeployed()) {
      res.status(500).json({ success: false, error: 'APP_TOKEN is not configured' });
      return;
    }
    next();
    return;
  }

  const header = req.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!secretsMatch(token, expected)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  next();
}
