# RM ONE — Operational Intelligence

RM ONE gives project-driven organizations one place to run their operations: projects, opportunities, people, and hours — with forecasting, analytics, and AI-assisted insights on top.

## Monorepo layout

| Path | Description |
|------|-------------|
| `artifacts/rmone-web` | Web application (React + Vite) |
| `artifacts/rmone-mobile` | Mobile app (Expo / React Native) |
| `artifacts/api-server` | API server (Node.js + Express + TypeScript) |
| `artifacts/mockup-sandbox` | Isolated UI component preview sandbox |
| `lib/` | Shared TypeScript libraries (database, domain logic) |
| `scripts/` | Build and maintenance scripts |

## Key capabilities

- Projects, opportunities, leads, and companies in a single workspace
- Team staffing, weekly hour allocations, and overallocation signals
- Resource forecasting, utilization, and capacity analytics
- Excel onboarding and recurring imports with intelligent column matching
- Analytics Center, Reports, and usage insights
- AI-assisted daily briefings, alerts, and chat
- Multi-tenant with role- and audience-based access control

## Tech stack

TypeScript across the stack — React + Vite (web), Expo / React Native (mobile), Node.js + Express (API), SQL Server on AWS RDS, Redis, AWS Elastic Beanstalk & S3, pnpm workspaces.

## Development

```bash
pnpm install

# run an app
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/rmone-web run dev
pnpm --filter @workspace/rmone-mobile run dev
```

The API server requires environment configuration (database connection strings, session secret, AI provider keys) before it will start.

## License

Proprietary — all rights reserved.
