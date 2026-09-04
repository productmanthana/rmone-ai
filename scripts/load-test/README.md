# RM ONE staged load testing

Goal: prove the fleet handles **1,000 concurrent users** before launch, in
stages, without taking down shared infrastructure on the way.

## The environments

| Env   | Shape (Terraform `infra/aws/variables.tf`)            | Database                          |
|-------|--------------------------------------------------------|-----------------------------------|
| pilot | ALB fleet (EB env `rmone-pilot2`), r6i.large ×2–4, CPU ASG | **shared** non-prod SQL Express |
| prod  | ALB, r6i.large ×2–6, 4 workers, db cache bus, CPU ASG  | prod db.r7i.2xlarge               |

Pilot now mirrors production topology: the live pilot is a load-balanced
fleet — Elastic Beanstalk environment `rmone-pilot2` (application ALB,
min 2 / max 4, CPU autoscaling) behind the original pilot CNAME. It got there
via blue/green replacement because EB cannot attach a load balancer to an
existing single-instance environment (LoadBalancerType is create-time-only).
The original single box is terminated; its Terraform entry remains with
`retired = true` as owner of the shared bucket/role (infra/aws/variables.tf).
Only the smoke stage has run against the fleet so far — stages 2–4 are still
pending. Caveat: pilot shares its SQL Server with dev and qa, so a DB-heavy
full-scale soak needs either a scheduled window or a temporary bump of
`nonprod_db_instance_class`.

## Staged plan

Run stages in order. Do not skip ahead — each stage exists to catch a class of
failure while it is still cheap to diagnose.

1. **smoke (25 conns, 30s)** — from anywhere (including the development workspace).
   Validates: env healthy, ALB routing, no config-level errors.
   Paths: `/health`, then `/` (HTML), then one authed API GET.
2. **s250 (250 conns, 2 min)** — from an EC2 instance in us-east-1 (the
   existing migration-runner box works). Validates: keep-alive handling,
   worker balance, pool acquire behaviour, p99 under light saturation.
3. **s500 (500 conns, 3 min)** — same source. Watch the CPU autoscaling
   trigger fire (>60% avg CPU for 3 min → +1 instance) and confirm p99
   recovers after scale-out instead of collapsing.
4. **s1000 (1000 conns, 5 min)** — same source, agreed window. Validates the
   launch target. Success bar: error rate <0.1%, p99 <2s on page-data APIs
   once the fleet has scaled, no 5xx bursts during scale events.

Why not run big stages from this workspace: 1,000 sockets from one container
over a transatlantic-ish link measures the container's network, not the fleet.
Smoke from here is fine and useful.

## What to watch while a stage runs

- **autocannon output** — non-2xx counts, p50/p97.5/p99 latency, throughput.
- **EB console / CloudWatch** — environment health, per-instance CPU,
  `aws elasticbeanstalk describe-events` for scale-out events.
- **RDS metrics** — CPU, DB connections (the app's fleet-wide budget is
  `POOL_BUDGET`, set per env in Terraform), read/write latency.
- **App logs (CloudWatch)** — pool acquire timeouts (`[db]` warnings), lock
  timeouts, 5xx stack traces.

## Choosing paths

- `/health` — pure Node liveness, no DB. Baseline for connection handling.
- `/` — static HTML through the SPA catch-all; tests compression + static path.
- Authed API GETs (`RMONE_TOKEN` env var) — the real test. Pick the pages
  users actually open: auth/me, records lists, home overlay. Keep the set
  small and identical between stages so runs compare cleanly.

Bearer tokens: sign in as the pilot tenant's test user and copy the token the
SPA stores, or mint one with the environment's SESSION_SECRET. Never commit a
token, and never reuse a prod token against non-prod (different secrets).

## Reading results honestly

- Compare stages by the SAME path, same source host, same duration.
- A p99 that doubles while throughput also doubles is fine; a p99 that
  explodes while throughput flatlines means a saturated resource — check CPU
  first (should scale out), then DB connections/CPU, then lock waits.
- 429s are the API rate limiter (300 req/min per authed user): expected when
  one token fans out over hundreds of connections. Either spread across a few
  test users or treat 429s as "limiter works", not app failure.
