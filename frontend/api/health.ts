import type { ApiRequest, ApiResponse } from '../server/http.js';
import { inspectJwtConfiguration } from '../server/jwt.js';

export default function health(req: ApiRequest, res: ApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const issues: string[] = [];
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) issues.push('TELEGRAM_BOT_TOKEN_MISSING');
  const jwt = inspectJwtConfiguration(process.env.NHOST_JWT_SECRET);
  if (jwt.issue) issues.push(jwt.issue);
  if (!process.env.NHOST_ADMIN_SECRET?.trim()) issues.push('NHOST_ADMIN_SECRET_MISSING');
  try {
    const url = new URL(process.env.NHOST_GRAPHQL_URL ?? '');
    if (url.protocol !== 'https:' || url.pathname === '/' || url.pathname.includes('/console')) issues.push('NHOST_GRAPHQL_URL_INVALID');
  } catch { issues.push('NHOST_GRAPHQL_URL_MISSING_OR_INVALID'); }
  return res.status(issues.length ? 503 : 200).json({ status: issues.length ? 'setup-required' : 'configured', issues });
}
