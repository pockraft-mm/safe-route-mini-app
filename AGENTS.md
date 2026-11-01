# Repository Guidelines

## Project Structure & Module Organization

The repository root contains the backend and a separate `frontend/` app. `Safe-Route-API/` is retired; do not add it as a submodule.

- `frontend/src/` contains the React/Vite UI, GraphQL client, types, and MapLibre map panel.
- `nhost/migrations/` contains the PostgreSQL schema; `nhost/functions/` contains Telegram authentication and secure trip joining.
- `nhost/PERMISSIONS.md` documents required Hasura permissions and relationships.
- The original `app.js`, `server.js`, `routes/`, `controllers/`, `config/`, `middlewares/`, and `utils/` remain as legacy Express reference code.

## Build, Test, and Development Commands

Run frontend commands from `frontend/`:

```bash
npm install                         # Install frontend dependencies
npm run dev                         # Start the Vite development server
npm run build                       # Type-check and create the production bundle
npm run preview                     # Serve the production bundle locally
```

Copy `frontend/.env.example` to `frontend/.env.local` for Nhost and map settings. Server-only Telegram and JWT secrets belong in Nhost Functions, never in `VITE_*` variables. Apply `nhost/migrations/default/001_safe_route.sql` to the Nhost project and follow `nhost/PERMISSIONS.md`.

## Coding Style & Naming Conventions

Use TypeScript with ES imports/exports, two-space indentation in frontend code, semicolons, and single quotes. Use camelCase for functions/variables, PascalCase for React components, and descriptive filenames such as `MapPanel.tsx` and `telegram-auth.ts`. Keep GraphQL calls in `frontend/src/lib/api.ts`; keep privileged logic inside Nhost Functions. No formatter or linter is configured, so preserve surrounding style and avoid unrelated reformatting.

## Testing Guidelines

No test framework or coverage threshold is configured yet. At minimum, run `npm run build`, test demo mode manually, and verify Telegram auth, two-person membership, permissions, expiry escalation, status changes, and location updates against an Nhost project before release. Add tests under `frontend/src/**/*.test.ts` when a test runner is introduced.

## Commit & Pull Request Guidelines

The existing history contains only `Initial Commit`, so no established message convention can be inferred. Use concise imperative subjects (for example, `Add trip status validation`) and keep each commit focused. Pull requests should explain the behavior change, identify database/schema effects, list validation commands run, link any issue, and include request/response examples when API behavior changes.

## Security & Configuration

Never commit `.env`, passwords, or connection strings. Use environment variables for secrets, review SQL changes for safe migrations, and avoid logging sensitive request or database data. Verify database connectivity and schema changes locally before opening a pull request.
