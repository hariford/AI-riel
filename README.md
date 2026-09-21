# AI'riel

In-house AI coding assistant for company developers, powered by **Azure AI Foundry**.
A desktop app (Electron) that opens a working directory, reads and searches the code, proposes
edits with diff review, runs builds and tests with approval, and takes voice input. Company SSO
via Entra ID; per-user usage tracked through a gateway in Azure.

```
apps/desktop        Electron + React desktop app (main: MSAL sign-in, agent host; renderer: chat UI)
packages/agent-core Agent loop, permissions, compaction, gateway model provider (pure TS, tested)
packages/tools      Workspace-confined tools: list/read/glob/grep, edit/write with diffs, run_command, git
packages/protocol   Zod schemas shared by desktop and gateway (messages, SSE events, IPC names)
services/gateway    Fastify API: Entra JWT → Azure AI Foundry streaming, usage logging, speech tokens
infra/              Bicep (Foundry, Container Apps, SQL, Speech, App Insights) + Entra app script
docs/               Project plan, ADRs, onboarding
```

## Quick start (local, no Azure yet)

```powershell
pnpm install
pnpm build
pnpm test

# Terminal 1 — gateway in dev mode (fake auth, in-memory usage). Needs a Foundry endpoint to answer.
cd services/gateway; copy .env.example .env; pnpm dev

# Terminal 2 — desktop
$env:AIRIEL_AUTH_DISABLED = 'true'; $env:AIRIEL_GATEWAY_URL = 'http://localhost:8080'
pnpm dev:desktop
```

See `docs/ONBOARDING.md` for Azure setup (Foundry, Entra, Speech) and `docs/PROJECT-PLAN.md` for the roadmap.
