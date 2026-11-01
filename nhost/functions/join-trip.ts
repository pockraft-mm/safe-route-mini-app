// Compatibility entrypoint for existing Nhost deployments.
import type { Request, Response } from 'express';
import handler from '../../frontend/server/join-trip.js';
import { handleCors } from '../lib/http.js';

export default function joinTrip(req: Request, res: Response) {
  if (handleCors(req, res)) return;
  return handler(req, res);
}
