# WatchDog

WatchDog is an open-source situational-awareness dashboard for Bay Area public
safety and mobility signals. It combines Caltrans camera surfaces, live incident
feeds, environmental signals, public transit alerts, and enrichment workers into
a Next.js operator console.

The project is in active development. Contributions are welcome, especially on
well-scoped bugs, tests, data-source reliability, and documentation.

## What Is In This Repo

```text
apps/web                  Next.js 15 app for public and operator surfaces
packages/db               Drizzle schema, migrations, and typed database client
packages/sync             Caltrans and public-source sync/parsing jobs
packages/ingestion        Signal ingestion, correlation, and camera helpers
packages/openclaw-worker  OpenClaw fusion and enrichment worker
docs/                     Product, technical, status, and design documents
```

Start with these docs:

1. [`docs/STATUS.md`](docs/STATUS.md) - what is implemented here today.
2. [`docs/TRD.md`](docs/TRD.md) - architecture and technical requirements.
3. [`docs/PRD.md`](docs/PRD.md) - product goals and user workflows.
4. [`CONTRIBUTING.md`](CONTRIBUTING.md) - local setup and PR expectations.
5. [`SECURITY.md`](SECURITY.md) - private vulnerability reporting.
6. [`docs/MAINTAINING.md`](docs/MAINTAINING.md) - repo stewardship runbook.

## Stack

- Next.js 15, React 19, TypeScript strict
- Tailwind CSS 4 and shadcn-style UI primitives
- Supabase Postgres, Storage, Auth, and RLS
- Drizzle ORM
- pnpm workspaces and Turborepo
- Vitest for unit tests
- GitHub Actions for CI, dependency review, and CodeQL

## Local Setup

Prerequisites:

- Node 20 or newer
- pnpm 9 or newer
- A Supabase project you control

```bash
git clone https://github.com/NewCoder3294/watchdog.git
cd watchdog
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm dev
```

Fill in the required Supabase values in `apps/web/.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
CRON_SECRET=
```

Most third-party API keys in `.env.example` are optional. When optional keys are
missing, the relevant source usually disables itself or falls back to local
logging/in-memory behavior.

Apply database migrations with:

```bash
pnpm db:migrate
```

Then run the app at http://localhost:3000.

## Development Commands

```bash
pnpm dev          # run workspace dev tasks
pnpm lint         # lint workspace packages
pnpm typecheck    # TypeScript checks
pnpm test         # Vitest suites
pnpm build        # production build
```

## Contribution Flow

- Pick an open issue or open a proposal before starting a large change.
- Branch from `main` using `feat/<topic>`, `fix/<topic>`, `docs/<topic>`,
  `test/<topic>`, or `chore/<topic>`.
- Keep PRs focused on one logical change.
- Use Conventional Commit-style PR titles, for example
  `fix(web): block invalid camera-frame hosts`.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` before opening or updating
  a PR.

Good first contribution areas:

- Add focused tests for cron routes under `apps/web/app/api/cron`.
- Improve parser coverage in `packages/sync`.
- Tighten docs for local Supabase setup.
- Fix small CodeQL, lint, or typecheck findings.

## Security

Do not open public issues for vulnerabilities. Use the private process in
[`SECURITY.md`](SECURITY.md). The repository runs CodeQL, dependency review, and
Dependabot to keep contributor-facing security feedback visible in pull
requests.

## License

MIT. See [`LICENSE`](LICENSE).
