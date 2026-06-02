---
name: SoulSync project setup
description: Port config, DB migration, and proxy setup for SoulSync monorepo
---

# SoulSync Project Setup

## Ports
- `artifacts/soulsync` (frontend): PORT=19766, external=3000, artifact previewPath="/"
- `artifacts/api-server` (backend): PORT=8080, external=8080
- Port 8081 → external 80 (unused in dev)

## Vite Proxy
`artifacts/soulsync/vite.config.ts` proxies `/api` and `/socket.io` to `http://localhost:8080`. This is required — without it, browser API calls from port 19766 would 404.

## Workflow Command
`PORT=8080 pnpm --filter api-server run dev & PORT=19766 BASE_PATH=/ pnpm --filter soulsync run dev`

## Database
`lib/db` package uses drizzle-kit. Run `cd lib/db && pnpm run push` to push schema to PostgreSQL.
Tables: ss_users, ss_companions, ss_chat_messages, ss_quest_progress, ss_psych_messages, ss_psych_bookings, ss_user_settings, ss_mood_logs.

## Artifact Registration
The artifact.toml exists at `artifacts/soulsync/.replit-artifact/artifact.toml` but may not show up in `listArtifacts()`. The app is still fully accessible since the workflow runs and ports are mapped correctly.

**Why:** The artifact was created via file system in a prior session, not via `createArtifact()` API, so the Replit agent API doesn't index it — but Replit's routing still serves it.
