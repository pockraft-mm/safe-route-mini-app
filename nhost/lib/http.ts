import type { Request, Response } from 'express';

// Return true when the request was completed before reaching the handler.
export function handleCors(req: Request, res: Response): boolean {
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? 'https://safe-route-mini-app-frontend.vercel.app')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const origin = req.headers.origin;
  res.vary('Origin');
  res.setHeader('Access-Control-Allow-Origin', origin && allowedOrigins.includes(origin) ? origin : '');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (origin && !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: 'This frontend origin is not allowed.' });
    return true;
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
