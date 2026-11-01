CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE trip_status AS ENUM ('ACTIVE', 'EMERGENCY', 'COMPLETED');

CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  invite_code text NOT NULL UNIQUE,
  status trip_status NOT NULL DEFAULT 'ACTIVE',
  deadline_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_latitude numeric(9,6);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_longitude numeric(9,6);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS destination text;

CREATE TABLE trip_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  display_name text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, user_id),
  UNIQUE (trip_id, display_name)
);

CREATE TABLE trip_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy numeric,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, user_id)
);

CREATE OR REPLACE FUNCTION generate_invite_code() RETURNS trigger AS $$
BEGIN
  NEW.invite_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trips_invite_code BEFORE INSERT ON trips FOR EACH ROW WHEN (NEW.invite_code IS NULL OR NEW.invite_code = '') EXECUTE FUNCTION generate_invite_code();

CREATE OR REPLACE FUNCTION mark_expired_trips() RETURNS void AS $$
BEGIN
  UPDATE trips SET status = 'EMERGENCY', updated_at = now()
  WHERE status = 'ACTIVE' AND deadline_at <= now();
END;
$$ LANGUAGE plpgsql;

-- Enable pg_cron in the Nhost project, then schedule:
-- SELECT cron.schedule('safe-route-expiry', '* * * * *', $$SELECT mark_expired_trips();$$);
