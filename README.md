# Task API — Supabase Authentication (A4)

A Node.js and Express REST API that combines Supabase email/password authentication with PostgreSQL-backed task management. Supabase issues JWT access tokens; protected routes verify tokens with Supabase before returning user data.

## Features

- Email/password signup and login through Supabase Auth.
- Bearer-token middleware validates access tokens with `supabase.auth.getUser(token)`.
- Protected profile and dashboard endpoints plus a public information endpoint.
- Swagger UI with HTTP Bearer/JWT authorization at `/docs`.
- PostgreSQL-backed task CRUD retained from the earlier CRUD assignment.
- Docker Compose starts the API and PostgreSQL services.
- Local `.env` files are ignored; `.env.example` contains placeholders only.

## Requirements

- Node.js 18+ and npm
- Docker Desktop with Docker Compose
- A Supabase project

## Supabase setup

1. Create a Supabase project.
2. In **Project Settings → API Keys**, copy the Project URL and the public anon/publishable key. Do not use a service-role or secret key.
3. For this practice assignment, turn off **Confirm email** under **Authentication → Sign In / Providers → Email** so a test account can log in immediately. In production, email confirmation should normally remain enabled.
4. Create a local environment file:

```powershell
Copy-Item .env.example .env
```

Set the values in `.env`:

```env
DATABASE_URL=postgres://postgres:dev@localhost:5432/tasks
POSTGRES_PASSWORD=dev
PORT=3000
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=your_public_anon_or_publishable_key
```

Never commit `.env`. The example file contains placeholders and is safe to publish.

## Run the project

Install dependencies:

```powershell
npm install
```

Build and start the API and database:

```powershell
docker compose up --build
```

The API listens on `http://localhost:3000`. Keep the terminal running while testing. Stop it with `Ctrl+C`; `docker compose down` stops containers without deleting the named database volume. Do not add `-v` unless you intend to delete the database volume.

Useful URLs:

- Health: http://localhost:3000/health
- Swagger UI: http://localhost:3000/docs
- Public information: http://localhost:3000/public/info

## Authentication endpoints

| Method | Endpoint | Purpose | Authentication |
|---|---|---|---|
| POST | `/auth/signup` | Create a Supabase user | None |
| POST | `/auth/login` | Verify credentials and return JWT tokens | None |
| POST | `/auth/logout` | Acknowledge logout for the authenticated caller | Bearer token |
| GET | `/protected/profile` | Return the verified user's profile | Bearer token |
| GET | `/protected/dashboard` | Return protected dashboard data | Bearer token |
| GET | `/public/info` | Return public welcome information | None |

### Swagger authentication flow

1. Execute `POST /auth/signup` with an email and password.
2. Execute `POST /auth/login` using the same credentials.
3. Copy the `access_token` value from the login response.
4. Click **Authorize** in Swagger UI and paste only the token value. Swagger adds the `Bearer` prefix.
5. Execute `GET /protected/profile`. A valid token returns `200`; a missing or invalid token returns `401`.
6. Execute `POST /auth/logout` with the bearer token.

Expected successful status codes: signup `201`, login `200`, protected profile `200`, logout `204`.

### Logout behavior

The logout route is protected and returns `204 No Content`. This acknowledges logout; the client must discard its access and refresh tokens. Supabase access tokens are stateless JWTs, so this endpoint does not instantly revoke an already-issued access token. The token can remain valid until expiry unless a server-side revocation strategy is added. This limitation is documented rather than claiming that the JWT has been revoked.

## Swagger test evidence

The local Swagger tests returned the expected responses. The redacted evidence images are included in the project ZIP under `screenshots/`:

- `signup.png` — POST `/auth/signup`, 201 Created
- `login.png` — POST `/auth/login`, 200 OK
- `protected-profile.png` — GET `/protected/profile`, 200 OK
- `logout.png` — POST `/auth/logout`, 204 No Content

For the repository copy, add the four PNG files from the ZIP's `screenshots/` folder to this repository's `screenshots/` folder.

## Existing PostgreSQL task API

| Method | Endpoint | Purpose | Success |
|---|---|---|---|
| GET | `/tasks` | List tasks; supports `done` and `search` filters | 200 |
| GET | `/tasks/:id` | Get one task | 200 |
| POST | `/tasks` | Create a task | 201 |
| PUT | `/tasks/:id` | Update a task | 200 |
| DELETE | `/tasks/:id` | Delete a task | 204 |
| GET | `/stats` | Get task counts | 200 |
| POST | `/reset` | Restore sample tasks | 200 |

## Tests

Run:

```powershell
npm test
```

The PostgreSQL CRUD integration test requires a disposable database configured through `TEST_DATABASE_URL`. Without that variable, Node's test runner reports the integration test as **skipped**. The authentication flow was manually tested in Swagger UI; the observed success codes are recorded above and in the screenshots.

## Security checklist

- [x] `.env` and other local environment files are excluded by `.gitignore`.
- [x] `.env.example` contains placeholders only.
- [x] The application uses the public Supabase anon/publishable key, not the service-role key.
- [x] Protected routes verify bearer tokens with Supabase.
- [x] Passwords and JWTs are excluded from the redacted screenshot copies in the ZIP.
- [ ] Before production use, add server-side session revocation and stricter rate limiting.

## Project structure

```text
.
├── index.js
├── openapi.json
├── package.json
├── Dockerfile
├── compose.yaml
├── .env.example
├── .gitignore
├── screenshots/
└── test/
    └── api.test.js
```
