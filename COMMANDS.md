# Commands Reference

## Local Development

```bash
cd worker && npm run dev
```
Starts the Cloudflare Worker locally at `http://localhost:8787`. Serves both the API and the built frontend. Uses a local D1 database.

```bash
cd frontend && npm run dev
```
Starts the Vite dev server at `http://localhost:5173` with hot reload. Proxies `/api` requests to the worker. Run this alongside `worker dev` when actively editing frontend code.

```bash
cd frontend && npm run build
```
Compiles the React frontend into `frontend/dist/`. The worker serves these static files in production. Must be run before deploying.

---

## Database (D1)

```bash
cd worker && npx wrangler d1 execute cornell-clubs --local --file=schema.sql
```
Wipes and recreates the local database schema. Run this if you change `schema.sql` or want to reset local state.

```bash
cd worker && npx wrangler d1 execute cornell-clubs --local --file=seed.sql
```
Seeds the local database with the 197 clubs. Run after the schema command above.

```bash
cd worker && npx wrangler d1 execute cornell-clubs --remote --file=schema.sql
```
Same as above but against the live Cloudflare database. Destructive — wipes all data.

```bash
cd worker && npx wrangler d1 execute cornell-clubs --remote --command="YOUR SQL HERE"
```
Runs a one-off SQL statement against the live database. Used for things like resetting a club's stats:
```bash
--command="UPDATE clubs SET elo = 1000, wins = 0, losses = 0 WHERE name = 'Club Name'"
```

Drop `--remote` and add `--local` to run against your local DB instead.

---

## Descriptions

```bash
node sync-descriptions.js
```
Reads `descriptions.json` and pushes all descriptions to the live remote database.

```bash
node sync-descriptions.js --local
```
Same but targets your local database.

---

## Deploy to Cloudflare

```bash
cd frontend && npm run build && cd ../worker && npm run deploy
```
Builds the frontend and deploys everything (worker + static assets) to Cloudflare. Takes ~10 seconds. The D1 database is unaffected — only code and frontend changes are deployed.

---

## Install Dependencies

```bash
cd worker && npm install
cd frontend && npm install
```
Install Node dependencies for each package. Run once after cloning or after adding new packages.

---

## First-Time Setup (never need to repeat)

```bash
cd worker && npx wrangler d1 create cornell-clubs
```
Creates the D1 database on Cloudflare. Only needed once. Copy the returned `database_id` into `worker/wrangler.toml`.
