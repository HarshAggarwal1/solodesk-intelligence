# SoloDesk Intelligence

A freelancer operations assistant that converts client briefs into proposals, stores an approved scope baseline, compares new requests against that baseline, and drafts change orders.

## Features
- Brief-to-proposal extraction through an OpenAI-compatible chat-completions endpoint (Gemma or another compatible open-weight model).
- Deterministic quote totals and editable line items.
- Versioned scope baseline and scope-change analysis.
- PostgreSQL persistence when `DATABASE_URL` is set; local JSON-file persistence for development.
- PDF quotation export.
- Demo mode without an AI key (rule-based extraction fallback).
- Optional memory-provider hook, with local project history always retained.

## Stack
- React + Vite
- Node.js + Express
- PostgreSQL (`pg`) or local JSON storage
- PDFKit
- OpenAI-compatible inference API

## Run locally
Requires Node.js 20+. You do **not** need PostgreSQL installed locally: leave `DATABASE_URL` empty for local development, or point it at a hosted PostgreSQL database.

### 1. Backend
```bash
cd server
cp .env.example .env
npm install
npm run dev
```
The API runs on `http://localhost:8080`.

### 2. Frontend
In another terminal:
```bash
cd client
npm install
npm run dev
```
Open the URL printed by Vite (normally `http://localhost:5173`).

The default demo is intentionally usable without an AI API key. Set `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` to use a compatible model endpoint.

## Environment variables
See `server/.env.example`.

- `AI_BASE_URL`: base URL for an OpenAI-compatible API, e.g. the provider's API root.
- `AI_API_KEY`: provider API key.
- `AI_MODEL`: exact model identifier supported by your provider.
- `DATABASE_URL`: PostgreSQL connection string. If omitted, the server uses `server/data.json` for local development only.
- `JWT_SECRET`: change before deployment.
- `CLIENT_ORIGIN`: frontend origin for CORS.
- `BACKBOARD_API_KEY`: reserved optional integration setting. The app remains functional without it; the integration must be connected to the exact API/SDK version available in your Backboard account before enabling it.

## Public deployment (Render + Supabase)
1. Push this folder to a GitHub repository.
2. Create a Supabase project on its hosted dashboard. No local Postgres installation is required. In Supabase, copy a PostgreSQL connection string from **Connect**. Prefer the pooler connection string if your deployment network cannot connect to the direct database host. Keep it private.
3. Create a Render Web Service from the repository with root directory `server`:
   - Build command: `npm install`
   - Start command: `npm start`
4. Add these Render environment variables:
   - `DATABASE_URL`: Supabase PostgreSQL connection string
   - `JWT_SECRET`: a random secret of at least 32 characters
   - `CLIENT_ORIGIN`: your Render static-site URL (add your custom domain after configuring it)
   - `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`: a compatible open-weight model provider, if using real AI inference
   - `NODE_ENV=production`
5. Deploy the frontend as a Render Static Site with `client` as root:
   - Build command: `npm install && npm run build`
   - Publish directory: `dist`
   - Set `VITE_API_URL` to the deployed server URL (no trailing slash).
6. Set `VITE_API_URL` to the deployed API URL, and deploy the frontend.
7. Update `CLIENT_ORIGIN` to the frontend URL and redeploy the API. Add the `.tech` domain in Render and update `CLIENT_ORIGIN` to include the final domain.
8. Register a test account, verify that projects persist after redeploy, and test that one account cannot access another account's project. Never expose `DATABASE_URL`, `JWT_SECRET`, or `AI_API_KEY` in frontend environment variables.

Important: Render's free Postgres has lifecycle/expiry limitations. For a durable public demo, verify the current plan limits and back up your data.

## API routes
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `POST /api/projects/:id/proposal`
- `POST /api/projects/:id/baseline`
- `POST /api/projects/:id/analyze-change`
- `POST /api/projects/:id/change-orders`
- `GET /api/projects/:id/quotation.pdf`
- `GET /api/memory/:projectId`

## Public MVP security notes
- Project endpoints require a signed bearer token; each project query is scoped to the authenticated user.
- Passwords are hashed with bcrypt. Use a unique JWT secret and keep it server-side.
- This is still an MVP, not a fully hardened commercial service: before accepting sensitive or paying users, add rate limiting, email verification, password reset, token revocation/session controls, monitoring, backups, and a privacy policy/terms.
- Use a production-grade database backup plan. Supabase free-tier quotas and inactivity policies can change; check current dashboard terms.

## Important product limitations
- AI output is a draft, not legal or financial advice.
- Review scope classifications and estimates before sharing them with a client.
- No email is sent automatically; users remain in control.
- Do not upload sensitive client information unless your model provider's data handling is acceptable to you.
- The local JSON storage fallback is for development only and is not suitable for concurrent production traffic.
