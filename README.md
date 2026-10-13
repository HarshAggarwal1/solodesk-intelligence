# SoloDesk Intelligence

**AI-assisted project management for freelancers — from client briefs to scope-change approvals.**

SoloDesk Intelligence helps freelancers turn client briefs into proposals, establish an approved scope baseline, identify out-of-scope requests, and manage change orders before additional work begins.

**Live Demo:** https://solodesk-frontend.onrender.com

**Demo Video:** https://www.youtube.com/watch?v=Di9GaBFcfmA

## Features

- **AI-assisted proposal generation:** Extract project requirements from client briefs using a Gemma model through an OpenAI-compatible API.
- **Quotation management:** Generate editable proposal line items and calculate quote totals deterministically.
- **Scope baseline:** Save the agreed project scope as a reference for evaluating future requests.
- **Scope-change analysis:** Compare new client requests against the approved baseline and identify potential scope changes.
- **Change-order workflow:** Draft change orders, approve them internally, and send them to clients for approval.
- **Client approval links:** Share a dedicated link where clients can review a change order and approve or reject it.
- **Status tracking:** Track change orders through their lifecycle, from draft to client decision.
- **PDF quotation export:** Generate downloadable project quotations.
- **Persistent storage:** Use PostgreSQL in deployment or local JSON-file storage for development.
- **Demo mode:** Use rule-based extraction when AI inference is not configured.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite |
| Backend | Node.js, Express |
| Database | PostgreSQL, `pg` |
| AI inference | Gemma through an OpenAI-compatible API |
| PDF generation | PDFKit |
| Validation | Zod |
| Deployment | Render |

## How It Works

1. **Create a project:** Enter the client details, project brief, currency, and hourly rate.
2. **Generate a proposal:** Extract requirements and prepare a quotation.
3. **Approve the scope:** Save the agreed proposal as the project's scope baseline.
4. **Analyze new requests:** Compare additional client requests with the approved baseline.
5. **Create a change order:** Review the proposed scope changes, extra hours, and associated costs.
6. **Approve internally:** Review and approve the change order before sharing it.
7. **Request client approval:** Generate a shareable approval link for the client.
8. **Record the decision:** The client can approve or reject the proposed changes.

## Run Locally

**Requirements:** Node.js 20 or later.

PostgreSQL is optional for local development. If `DATABASE_URL` is not configured, the application uses local JSON-file storage.

### 1. Start the backend

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

The API runs at `http://localhost:8080`.

On Windows PowerShell, if `cp` is unavailable, use:

```powershell
Copy-Item .env.example .env
```

### 2. Start the frontend

Open another terminal:

```bash
cd client
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

### 3. Configure AI inference

The application can run in demo mode without an AI API key. To enable model-backed inference, configure the following variables in `server/.env`:

```env
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
```

Use the base URL, credentials, and exact model identifier required by your chosen provider.

## Environment Variables

See `server/.env.example` for the authoritative configuration template.

| Variable | Purpose |
|---|---|
| `AI_BASE_URL` | OpenAI-compatible inference API base URL |
| `AI_API_KEY` | Server-side inference API key |
| `AI_MODEL` | Model identifier supported by the provider |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret used to sign authentication tokens |
| `CLIENT_ORIGIN` | Frontend origin permitted by backend CORS |
| `CLIENT_URL` | Frontend base URL used to construct client approval links |
| `NODE_ENV` | Runtime environment, such as `production` |
| `BACKBOARD_API_KEY` | Optional integration setting, if supported by the current implementation |

Do not expose database credentials, JWT secrets, or AI provider keys through frontend environment variables.

## Deployment on Render

The frontend and backend are deployed separately.

### Backend — Web Service

Configure a Render Web Service using the `server` directory as its root.

- **Build command:** `npm install`
- **Start command:** `npm start`

Set the required environment variables in the Render dashboard, including:

- `DATABASE_URL`
- `JWT_SECRET`
- `CLIENT_ORIGIN`
- `CLIENT_URL`
- `NODE_ENV=production`
- `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` if using hosted AI inference

Use a hosted PostgreSQL database for persistent production storage. Keep all secrets server-side.

### Frontend — Static Site

Configure a Render Static Site using the `client` directory as its root.

- **Build command:** `npm install && npm run build`
- **Publish directory:** `dist`
- **Environment variable:** `VITE_API_URL`, set to the deployed backend URL without a trailing slash.

After deployment, ensure `CLIENT_ORIGIN` and `CLIENT_URL` point to the actual frontend origin. If you configure a custom domain, update these variables accordingly.

For client approval links, configure the frontend's static-site rewrite so application routes such as `/client-approval/:token` serve `index.html`.

## API Routes

### Authentication and Projects

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/auth/register` | Register an account |
| `POST` | `/api/auth/login` | Log in |
| `GET` | `/api/projects` | List projects |
| `POST` | `/api/projects` | Create a project |
| `GET` | `/api/projects/:id` | Retrieve a project |
| `POST` | `/api/projects/:id/proposal` | Generate a proposal |
| `POST` | `/api/projects/:id/baseline` | Save the approved scope baseline |
| `POST` | `/api/projects/:id/analyze-change` | Analyze a new request |
| `GET` | `/api/projects/:id/quotation.pdf` | Export a quotation |
| `GET` | `/api/memory/:projectId` | Retrieve project history |

### Change Orders

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/projects/:id/change-orders` | Create a change order |
| `POST` | `/api/projects/:id/change-orders/:orderId/approve` | Approve a change order internally |
| `POST` | `/api/projects/:id/change-orders/:orderId/send-for-approval` | Generate a client approval link |
| `GET` | `/api/client-approval/:token` | Retrieve a change order using its approval token |
| `POST` | `/api/client-approval/:token/decision` | Record the client's approval or rejection |

## Security and Limitations

- Authenticated project operations should be scoped to the owning user.
- Passwords should be hashed, and JWT secrets must remain server-side.
- Client approval links should use unguessable, expiring tokens and enforce valid state transitions.
- The local JSON storage fallback is intended for development, not concurrent production traffic.
- AI-generated proposals and scope classifications require human review.
- The application does not automatically send emails; users share approval links themselves.
- This is an MVP. Before handling sensitive or paying customers, add appropriate rate limiting, account recovery, session and token controls, monitoring, database backups, privacy documentation, and terms of service.
- Review your AI provider's data-handling policies before submitting confidential client information.

## Future Improvements

Potential extensions include email notifications, audit history, stronger session management, automated reminders, and richer project reporting.

## License

Add a `LICENSE` file and specify the applicable license before distributing the project as open source.
