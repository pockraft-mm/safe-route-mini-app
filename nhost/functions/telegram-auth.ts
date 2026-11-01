import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string };

export default function telegramAuth(req: Request, res: Response) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const initData = String(req.body?.initData ?? '');
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const jwtSecret = getJwtSigningKey(process.env.NHOST_JWT_SECRET);
  if (!botToken || !jwtSecret) return res.status(500).json({ error: 'Telegram auth is not configured.' });

  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash') ?? '';
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!receivedHash || receivedHash.length !== calculatedHash.length || !timingSafeEqual(Buffer.from(receivedHash), Buffer.from(calculatedHash))) return res.status(401).json({ error: 'Invalid Telegram init data.' });

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > 86400) return res.status(401).json({ error: 'Telegram session expired.' });
  const user = JSON.parse(params.get('user') ?? '{}') as TelegramUser;
  if (!user.id) return res.status(400).json({ error: 'Telegram user is missing.' });

  const userId = `telegram:${user.id}`;
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Telegram user';
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ sub: userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, 'https://hasura.io/jwt/claims': { 'x-hasura-user-id': userId, 'x-hasura-default-role': 'user', 'x-hasura-allowed-roles': ['user'] } }));
  const unsigned = `${header}.${payload}`;
  const signature = base64Url(createHmac('sha256', jwtSecret).update(unsigned).digest());
  return res.json({ token: `${unsigned}.${signature}`, user: { id: userId, telegramId: String(user.id), displayName } });
}

function base64Url(value: string | Buffer) { return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

function getJwtSigningKey(value?: string) {
  if (!value) return '';
  try {
    const config = JSON.parse(value) as { key?: string; type?: string };
    return config.type === 'HS256' ? config.key ?? '' : '';
  } catch {
    return value;
  }
}
