import type { ApiRequest, ApiResponse } from './http.js';
import { getJwtConfiguration, readJwtUserId } from './jwt.js';

export default async function joinTrip(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const userId = readJwtUserId(token, getJwtConfiguration(process.env.NHOST_JWT_SECRET));
  const code = String(req.body?.inviteCode ?? '').toUpperCase();
  if (!userId || !code) return res.status(401).json({ error: 'A valid session and invite code are required.' });
  const graphqlUrl = process.env.NHOST_GRAPHQL_URL;
  const adminSecret = process.env.NHOST_ADMIN_SECRET;
  if (!graphqlUrl || !adminSecret) return res.status(500).json({ error: 'The trip service is missing its Nhost settings in Vercel.' });

  const found = await request<{ trips: Array<{ id: string; invite_code: string; status: string; deadline_at: string; created_at: string; owner_id: string }> }>(graphqlUrl, adminSecret, `query FindTrip($code: String!) { trips(where: {invite_code: {_eq: $code}}) { id invite_code status deadline_at created_at owner_id } }`, { code });
  const trip = found.trips[0];
  if (!trip) return res.status(404).json({ error: 'Invite code not found.' });
  const members = await request<{ trip_members: Array<{ user_id: string; display_name: string; joined_at: string }> }>(graphqlUrl, adminSecret, `query Members($tripId: uuid!) { trip_members(where: {trip_id: {_eq: $tripId}}) { user_id display_name joined_at } }`, { tripId: trip.id });
  if (members.trip_members.some((member) => member.user_id === userId)) return res.status(409).json({ error: 'You already joined this trip.' });
  if (members.trip_members.length >= 4) return res.status(409).json({ error: 'This trip already has three watchers.' });
  await request(graphqlUrl, adminSecret, `mutation Join($tripId: uuid!, $userId: String!, $name: String!) { insert_trip_members_one(object: {trip_id: $tripId, user_id: $userId, display_name: $name}) { id } }`, { tripId: trip.id, userId, name: userId.replace('telegram:', 'Telegram ') });
  return res.json({ trip: { id: trip.id, inviteCode: trip.invite_code, status: trip.status, deadlineAt: trip.deadline_at, createdAt: trip.created_at, ownerId: trip.owner_id, members: [...members.trip_members, { user_id: userId, display_name: userId.replace('telegram:', 'Telegram '), joined_at: new Date().toISOString() }].map((member) => ({ userId: member.user_id, displayName: member.display_name, joinedAt: member.joined_at })), locations: [] } });
}

async function request<T = unknown>(url: string, secret: string, query: string, variables: Record<string, unknown>) { const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hasura-admin-secret': secret }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(10000) }); if (!response.ok) throw new Error('Nhost request failed.'); const body = await response.json() as { data: T; errors?: Array<{ message: string }> }; if (body.errors?.length) throw new Error(body.errors[0].message); return body.data; }
