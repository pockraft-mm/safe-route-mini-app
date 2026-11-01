// Compatibility entrypoint for existing Nhost deployments.
import type { Request, Response } from 'express';
import handler from '../../frontend/server/telegram-auth.js';
import { handleCors } from '../lib/http.js';

export default function telegramAuth(req: Request, res: Response) {
  if (handleCors(req, res)) return;
  return handler(req, res);
}
