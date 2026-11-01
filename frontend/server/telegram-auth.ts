import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ApiRequest, ApiResponse } from './http.js';
import { inspectJwtConfiguration, signJwt } from './jwt.js';

type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string };

export default function telegramAuth(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const initData = String(req.body?.initData ?? '');
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const { config: jwtConfig, issue: jwtIssue } = inspectJwtConfiguration(process.env.NHOST_JWT_SECRET);
  const configurationErrors: string[] = [];
  if (!botToken?.trim()) configurationErrors.push('BOT_TOKEN_MISSING');
  if (jwtIssue) configurationErrors.push(jwtIssue);
  if (configurationErrors.length) {
    // Record only issue codes, never credentials, initData, or the JWT configuration.
    console.error('[SafeRoute auth] Invalid server configuration', { issues: configurationErrors });
    return res.status(500).json({
      error: 'Telegram auth is not configured.',
      code: 'AUTH_CONFIG_INVALID',
      issues: configurationErrors,
    });
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash') ?? '';
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken!).digest();
  const calculatedHash = createHmac('sha256', new Uint8Array(secretKey)).update(dataCheckString).digest('hex');
  if (!receivedHash || receivedHash.length !== calculatedHash.length || !timingSafeEqual(new Uint8Array(Buffer.from(receivedHash)), new Uint8Array(Buffer.from(calculatedHash)))) return res.status(401).json({ error: 'Invalid Telegram init data.' });

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > 86400) return res.status(401).json({ error: 'Telegram session expired.' });
  const user = JSON.parse(params.get('user') ?? '{}') as TelegramUser;
  if (!user.id) return res.status(400).json({ error: 'Telegram user is missing.' });

  const userId = `telegram:${user.id}`;
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Telegram user';
  const token = signJwt({ sub: userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, 'https://hasura.io/jwt/claims': { 'x-hasura-user-id': userId, 'x-hasura-default-role': 'user', 'x-hasura-allowed-roles': ['user'] } }, jwtConfig!);
  return res.json({ token, user: { id: userId, telegramId: String(user.id), displayName } });
}
