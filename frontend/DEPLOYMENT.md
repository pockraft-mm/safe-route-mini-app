# Deploy SafeRoute on Vercel

Vercel serves the UI and `/api/telegram-auth`, `/api/join-trip`, and `/api/health`.
Nhost hosts PostgreSQL and GraphQL. Nhost Functions deployments are optional;
the frontend no longer calls them.

## Configure the existing Vercel project

Set Root Directory to `frontend`, framework to Vite, build command to
`npm run build`, and output directory to `dist`. Deploy from source so Vercel
builds the `api/` functions as well as the UI. Do not upload only `dist/`.

Add these environment variables for Production (and Preview if used):

| Name | Value |
| --- | --- |
| `VITE_NHOST_GRAPHQL_URL` | `https://qglwnislkluipqtvqpri.graphql.ap-southeast-1.nhost.run/v1` |
| `VITE_MAP_STYLE_URL` | `https://demotiles.maplibre.org/style.json` |
| `NHOST_GRAPHQL_URL` | Same GraphQL URL above |
| `TELEGRAM_BOT_TOKEN` | Current bot token from BotFather |
| `NHOST_ADMIN_SECRET` | Existing Nhost project admin secret |
| `NHOST_JWT_SECRET` | Full existing Nhost JWT JSON, including RS256 `signingKey` and `kid` if configured |

Keep the existing JWT keys. Copy the JSON as a value, without wrapping it in
extra quotes. Do not use `{{ secrets.NAME }}` references from Nhost in Vercel;
Vercel needs the resolved secret values. Never put credentials in `VITE_*`
variables, Git, or chat. The old `VITE_NHOST_FUNCTIONS_URL` is ignored.

Save settings, push the source changes, and wait for Vercel to finish deploying.
Set the bot's Main Mini App URL to the Vercel production domain.

## Check the deployment

1. Open `https://safe-route-mini-app-frontend.vercel.app/api/health`.
   Expect HTTP 200 with `{"status":"configured","issues":[]}`. A 503 response
   lists missing or invalid settings without exposing values. This checks
   configuration; it does not prove database connectivity or permissions.
2. Send an empty POST to the sign-in endpoint:

   ```bash
   curl -i --max-time 20 -H 'Content-Type: application/json' --data '{}' https://safe-route-mini-app-frontend.vercel.app/api/telegram-auth
   ```

   Expect HTTP 401 and `Invalid Telegram init data.`
3. Open the app from Telegram, create a trip, and confirm it appears in Nhost.
   Test joining from another Telegram account. Hasura permissions and
   relationships are still required for GraphQL reads and trip mutations.

Use Vercel Runtime Logs for server failures; never log bot tokens, JWTs, private
keys, or Telegram initData. An HTML response at `/api/*` means the API routes
were omitted or an SPA rewrite is swallowing them.

## Local development

`npm run dev` runs the UI with Vite. To exercise `/api/*`, run `vercel dev` from
the linked frontend project with server settings available locally. Keep local
secret files ignored by Git. Use a Telegram launch or a signed test fixture for
authentication; the regular browser cannot provide Telegram identity.
