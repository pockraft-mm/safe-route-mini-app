import type { GraphQLResponse, Trip, User } from '../types';

const graphqlUrl = import.meta.env.VITE_NHOST_GRAPHQL_URL;
const functionsUrl = import.meta.env.VITE_NHOST_FUNCTIONS_URL;

export const isDemoMode = !graphqlUrl || !functionsUrl;

export async function authenticateTelegram(): Promise<User> {
  const webApp = window.Telegram?.WebApp;
  const telegramUser = webApp?.initDataUnsafe?.user;

  if (isDemoMode) {
    return { id: 'demo-user', telegramId: 'demo', displayName: 'Demo user' };
  }
  if (!webApp?.initData || !telegramUser) {
    throw new Error('Open this app from Telegram to sign in. A regular browser session has no Telegram identity, so Nhost will reject trip mutations.');
  }

  let response: Response;
  try {
    response = await fetch(`${functionsUrl}/telegram-auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: webApp.initData }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    console.error('[SafeRoute auth] Endpoint unreachable or browser blocked the request', { endpoint: `${functionsUrl}/telegram-auth` });
    throw new Error('Cannot connect to the sign-in service. Check your connection and try again. If this continues, the Nhost function or its browser access settings need attention.');
  }

  if (!response.ok) {
    console.error('[SafeRoute auth] Sign-in request failed', { status: response.status });
    if (response.status === 404) throw new Error('The sign-in service is not deployed at the configured address. Check the Nhost telegram-auth function.');
    if (response.status >= 500) throw new Error('The sign-in service is unavailable. Check the Nhost function logs and server configuration.');
    throw new Error(`Telegram sign-in was rejected (HTTP ${response.status}). Close and reopen the Mini App to try again.`);
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The sign-in service returned an unexpected response. Check the Nhost Functions URL.');
  }
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
    console.error('[SafeRoute GraphQL] Request failed', {
      operation,
      endpoint: graphqlUrl,
      status: response.status,
      contentType,
      hasAuthToken: Boolean(sessionStorage.getItem('safe-route-token')),
      errors: body?.errors ?? null,
      diagnosis: diagnoseGraphQLError(message, Boolean(sessionStorage.getItem('safe-route-token'))),
    });
    const diagnosis = diagnoseGraphQLError(message, Boolean(sessionStorage.getItem('safe-route-token')));
    throw new Error(`${message}${diagnosis ? ` ${diagnosis}` : ''}`);
  }
  return body.data as T;
}

function diagnoseGraphQLError(message: string, hasAuthToken: boolean): string {
  const text = message.toLowerCase();
  if (text.includes("field 'trips' not found") || text.includes('field "trips" not found')) {
    return 'Hasura has not exposed public.trips in its GraphQL schema. In Nhost Console, open Data → public → trips → Track, then reload the Hasura schema. Also track trip_members and trip_locations and add the relationships documented in nhost/PERMISSIONS.md.';
  }
  if (text.includes('no mutations exist') || text.includes('field') && text.includes('not found') && text.includes('insert')) {
    return hasAuthToken
      ? 'The request has a session token. Check Hasura Data → public.trips is tracked and Permissions → user → insert is enabled for the required columns.'
      : 'No Nhost session token was sent. Open the Mini App from Telegram so Telegram initData can be verified, or remove frontend/.env.local to use local demo mode.';
  }
  if (text.includes('permission') || text.includes('not authorized')) {
    return 'Check Hasura permissions for the user role and confirm the request has a valid Telegram session token.';
  }
  if (text.includes('unknown type') || text.includes('unknown field')) {
    return 'Check that the migration ran, all tables are tracked, relationships are configured, and the Hasura schema cache is reloaded.';
  }
  return '';
}

export async function createTrip(userId: string, deadlineAt: string, startLatitude: number, startLongitude: number, destination: string): Promise<Trip> {
  const data = await graphql<{ insert_trips_one: { id: string; invite_code: string; status: Trip['status']; deadline_at: string; created_at: string; owner_id: string } }>(
    `mutation CreateTrip($ownerId: String!, $deadlineAt: timestamptz!, $latitude: numeric!, $longitude: numeric!, $destination: String!) {
      insert_trips_one(object: { owner_id: $ownerId, invite_code: "", deadline_at: $deadlineAt, start_latitude: $latitude, start_longitude: $longitude, destination: $destination }, on_conflict: {constraint: trips_pkey, update_columns: []}) {
        id invite_code status deadline_at created_at owner_id start_latitude start_longitude destination
      }
    }`, { ownerId: userId, deadlineAt, latitude: startLatitude, longitude: startLongitude, destination },
  );
  const trip = normalizeTrip(data.insert_trips_one);
  await graphql(`mutation AddOwner($tripId: uuid!, $userId: String!, $name: String!) { insert_trip_members_one(object: {trip_id: $tripId, user_id: $userId, display_name: $name}) { id } }`, { tripId: trip.id, userId, name: userId.replace('telegram:', 'Telegram ') });
  return { ...trip, startLatitude, startLongitude, destination, members: [{ userId, displayName: userId.replace('telegram:', 'Telegram '), joinedAt: new Date().toISOString() }] };
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
  return { id: value.id, inviteCode: value.invite_code, status: value.status, deadlineAt: value.deadline_at, createdAt: value.created_at, ownerId: value.owner_id, startLatitude: value.start_latitude, startLongitude: value.start_longitude, destination: value.destination, members: value.members ?? [], locations: value.locations ?? [] };
}
