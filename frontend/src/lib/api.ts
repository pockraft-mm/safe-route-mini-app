import type { GraphQLResponse, Trip, User } from '../types';

const graphqlUrl = import.meta.env.VITE_NHOST_GRAPHQL_URL;
const functionsUrl = import.meta.env.VITE_NHOST_FUNCTIONS_URL;

export const isDemoMode = !graphqlUrl || !functionsUrl;

export async function authenticateTelegram(): Promise<User> {
  const webApp = window.Telegram?.WebApp;
  const telegramUser = webApp?.initDataUnsafe?.user;

  if (isDemoMode || !webApp?.initData || !telegramUser) {
    return { id: 'demo-user', telegramId: 'demo', displayName: 'Demo user' };
  }

  const response = await fetch(`${functionsUrl}/telegram-auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: webApp.initData }),
  });

  if (!response.ok) throw new Error('Telegram authentication failed.');
  const result = (await response.json()) as { token: string; user: User };
  sessionStorage.setItem('safe-route-token', result.token);
  return result.user;
}

async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (isDemoMode) throw new Error('Nhost is not configured. Demo mode only supports local interactions.');
  const operation = query.match(/\b(query|mutation|subscription)\s+(\w+)/)?.[2] ?? 'AnonymousOperation';
  let response: Response;
  try {
    response = await fetch(graphqlUrl!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(sessionStorage.getItem('safe-route-token')
          ? { authorization: `Bearer ${sessionStorage.getItem('safe-route-token')}` }
          : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    console.error('[SafeRoute GraphQL] Network request failed', { operation, endpoint: graphqlUrl, error });
    throw new Error(`Could not reach Nhost GraphQL (${operation}). Check the endpoint and browser network/CORS errors.`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  let body: GraphQLResponse<T> | undefined;
  try {
    body = contentType.includes('application/json') ? await response.json() as GraphQLResponse<T> : undefined;
  } catch (error) {
    console.error('[SafeRoute GraphQL] Could not parse response', { operation, status: response.status, contentType, error });
  }
  if (!response.ok || !body || body.errors?.length) {
    const message = body?.errors?.map((item) => item.message).join('; ') || `Nhost returned HTTP ${response.status}${contentType ? ` (${contentType})` : ''}.`;
    console.error('[SafeRoute GraphQL] Request failed', { operation, endpoint: graphqlUrl, status: response.status, contentType, errors: body?.errors ?? null, diagnosis: diagnoseGraphQLError(message) });
    throw new Error(`${message}${diagnoseGraphQLError(message) ? ` ${diagnoseGraphQLError(message)}` : ''}`);
  }
  return body.data as T;
}

function diagnoseGraphQLError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes('no mutations exist') || text.includes('field') && text.includes('not found') && text.includes('insert')) {
    return 'Likely cause: the table is not tracked in Hasura, or the current role has no insert permission. Check Hasura Data → public.trips → Track, then Permissions → user → insert.';
  }
  if (text.includes('permission') || text.includes('not authorized')) {
    return 'Check Hasura permissions for the user role and confirm the request has a valid Telegram session token.';
  }
  if (text.includes('unknown type') || text.includes('unknown field')) {
    return 'Check that the migration ran, all tables are tracked, relationships are configured, and the Hasura schema cache is reloaded.';
  }
  return '';
}

export async function createTrip(userId: string, deadlineAt: string): Promise<Trip> {
  const data = await graphql<{ insert_trips_one: { id: string; invite_code: string; status: Trip['status']; deadline_at: string; created_at: string; owner_id: string } }>(
    `mutation CreateTrip($ownerId: String!, $deadlineAt: timestamptz!) {
      insert_trips_one(object: { owner_id: $ownerId, invite_code: "", deadline_at: $deadlineAt }, on_conflict: {constraint: trips_pkey, update_columns: []}) {
        id invite_code status deadline_at created_at owner_id
      }
    }`, { ownerId: userId, deadlineAt },
  );
  const trip = normalizeTrip(data.insert_trips_one);
  await graphql(`mutation AddOwner($tripId: uuid!, $userId: String!, $name: String!) { insert_trip_members_one(object: {trip_id: $tripId, user_id: $userId, display_name: $name}) { id } }`, { tripId: trip.id, userId, name: userId.replace('telegram:', 'Telegram ') });
  return { ...trip, members: [{ userId, displayName: userId.replace('telegram:', 'Telegram '), joinedAt: new Date().toISOString() }] };
}

export async function joinTrip(userId: string, inviteCode: string): Promise<Trip> {
  if (isDemoMode) throw new Error('Configure Nhost to join a shared trip.');
  const response = await fetch(`${functionsUrl}/join-trip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionStorage.getItem('safe-route-token') ?? ''}` },
    body: JSON.stringify({ userId, inviteCode: inviteCode.trim().toUpperCase() }),
  });
  const body = (await response.json()) as { trip?: Trip; error?: string };
  if (!response.ok || !body.trip) throw new Error(body.error ?? 'Could not join trip.');
  return body.trip;
}

export async function updateTripStatus(tripId: string, status: Trip['status']): Promise<void> {
  await graphql(`mutation UpdateTrip($id: uuid!, $status: trip_status!) { update_trips_by_pk(pk_columns: {id: $id}, _set: {status: $status}) { id } }`, { id: tripId, status });
}

export async function saveLocation(tripId: string, userId: string, latitude: number, longitude: number, accuracy?: number): Promise<void> {
  await graphql(`mutation SaveLocation($tripId: uuid!, $userId: String!, $latitude: numeric!, $longitude: numeric!, $accuracy: numeric) {
    insert_trip_locations_one(object: {trip_id: $tripId, user_id: $userId, latitude: $latitude, longitude: $longitude, accuracy: $accuracy}, on_conflict: {constraint: trip_locations_trip_id_user_id_key, update_columns: [latitude, longitude, accuracy, updated_at]}) { id }
  }`, { tripId, userId, latitude, longitude, accuracy: accuracy ?? null });
}

export async function fetchTrip(tripId: string): Promise<Trip> {
  const data = await graphql<{ trips_by_pk: any }>(`query Trip($id: uuid!) { trips_by_pk(id: $id) { id invite_code status deadline_at created_at owner_id members { user_id display_name joined_at } locations { user_id latitude longitude accuracy updated_at } } }`, { id: tripId });
  return normalizeTrip(data.trips_by_pk);
}

export async function fetchTripHistory(userId: string): Promise<Trip[]> {
  const data = await graphql<{ trips: Array<any> }>(`query TripHistory($userId: String!) { trips(where: {_or: [{owner_id: {_eq: $userId}}, {members: {user_id: {_eq: $userId}}}]}, order_by: {created_at: desc}) { id invite_code status deadline_at created_at owner_id members { user_id display_name joined_at } locations { user_id latitude longitude accuracy updated_at } } }`, { userId });
  return data.trips.map(normalizeTrip);
}

export async function updateTripDeadline(tripId: string, deadlineAt: string): Promise<void> {
  await graphql(`mutation UpdateTripDeadline($id: uuid!, $deadlineAt: timestamptz!) { update_trips_by_pk(pk_columns: {id: $id}, _set: {deadline_at: $deadlineAt}) { id } }`, { id: tripId, deadlineAt });
}

function normalizeTrip(value: any): Trip {
  return { id: value.id, inviteCode: value.invite_code, status: value.status, deadlineAt: value.deadline_at, createdAt: value.created_at, ownerId: value.owner_id, members: value.members ?? [], locations: value.locations ?? [] };
}
