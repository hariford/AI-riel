# AI'riel — Project Plan

## Context

The company wants an in-house AI coding assistant, **AI'riel**, that developers use the way they would use Claude Chat / Claude Desktop: a chat window that can open a working directory, read and search the code, propose edits, run builds and tests, and help debug. It must run on **Azure AI Foundry** (company cloud, company data boundary), support **voice input**, sign users in with **company SSO**, and record **per-user usage** for cost visibility.

Decisions already taken with the stakeholder:

| Decision | Choice |
|---|---|
| Form factor | Standalone desktop app (Windows first, macOS-capable) |
| Stack | TypeScript end to end |
| Voice (v1) | Push-to-talk speech-to-text only; replies are text |
| MVP scope | Chat + codebase read/search, file edits with diff review, terminal commands with approval, Entra ID SSO + usage tracking |

Intended outcome: a pilot-ready installer in roughly 12 weeks, then iterate with a pilot group of developers.

Assumption: AI'riel lives in a **new repository** (e.g. `C:\Users\twinford.compa\source\repos\AIriel`), not inside Accor DMR.

---

## Architecture

```
┌──────────────────────────── Developer machine ────────────────────────────┐
│  AI'riel Desktop (Electron)                                               │
│  ┌──────────────── Renderer (React) ───────────────┐  ┌── Main process ──┐│
│  │ Chat UI · streaming markdown · Monaco diff view │  │ MSAL SSO         ││
│  │ Approval prompts · terminal output · PTT button │  │ agent-core loop  ││
│  │ Azure Speech SDK (mic → text)                   │◄►│ tools: fs/grep/  ││
│  └─────────────────────────────────────────────────┘  │  edit/pty        ││
│                                                       │ SQLite history   ││
│                                                       └────────┬─────────┘│
└────────────────────────────────────────────────────────────────┼──────────┘
                                          Entra ID bearer token  │  HTTPS/SSE
                                                                 ▼
┌──────────────────────── Azure (company subscription) ─────────────────────┐
│ AI'riel Gateway (Azure Container Apps, Node/Fastify)                      │
│   validate JWT → forward chat/completions (stream) → log usage row        │
│   issue short-lived Speech tokens                                         │
│        │                          │                        │              │
│        ▼                          ▼                        ▼              │
│ Azure AI Foundry           Azure SQL (usage,          Azure AI Speech     │
│ (model deployments,        users, audit)              (STT)               │
│ content filters)                                                          │
│ Entra ID (app registration, groups)   App Insights (telemetry)            │
└───────────────────────────────────────────────────────────────────────────┘
```

### Why a gateway instead of calling Foundry from the desktop
- Foundry keys never ship inside the installer.
- Usage/cost per user is captured in one place (needed for the admin dashboard).
- Model deployment names, system prompt versions and content-filter policy can change without redeploying the desktop app.
- Later swap-in of Azure API Management (built-in token metrics/limits) is possible without touching the client.

### Component list

| Component | Tech | Notes |
|---|---|---|
| `apps/desktop` | Electron 3x, React 19, Vite, TypeScript, Tailwind, Monaco editor (diff view), `xterm.js` for terminal output | Electron over Tauri because `node-pty`, ripgrep binaries and Speech SDK are Node-native and mature |
| `packages/agent-core` | Pure TS, no Electron dependency | Agent loop (model call → tool calls → results → repeat), tool registry, permission engine, context/compaction. Unit-testable; reusable by a future VS Code extension |
| `packages/tools` | `@vscode/ripgrep`, `fast-glob`, `node-pty`, `diff` | Concrete tool implementations behind an interface |
| `packages/protocol` | Zod schemas | Shared types between renderer, main and gateway |
| `services/gateway` | Node 22, Fastify, `openai` npm (Azure OpenAI/Foundry endpoint), `@azure/identity`, `mssql` | Deployed to Azure Container Apps; IaC in Bicep under `infra/` |
| `services/admin` | Small React page served by gateway | Usage per user/team/day, cost estimate, model breakdown |
| `infra/` | Bicep + GitHub Actions (or Azure DevOps) | Foundry project, model deployments, Container App, SQL, Speech, App Insights, Entra app registrations |

### Model strategy (Azure AI Foundry)
- Deploy a **tool-calling-capable coding model** as the default (choose from current Foundry catalog; GPT-5-class OpenAI models and Anthropic Claude models are both available through Foundry). Keep the deployment name in gateway config so it can be swapped.
- Deploy a **small/cheap model** for side tasks: conversation titles, compaction summaries, voice transcript clean-up.
- Use the Foundry **OpenAI-compatible chat completions API with streaming and function calling** via the `openai` npm client pointed at the Foundry endpoint. The agent loop is written against a thin `ModelProvider` interface so a second provider can be added later.
- Keep Foundry default content filters on; add a custom system prompt versioned in the gateway.

### Agent loop (packages/agent-core)
1. Build messages: system prompt (AI'riel persona + tool guidance + workspace summary + optional `AIRIEL.md` project instructions from the workspace root) + conversation history.
2. Stream model response; surface text deltas to UI immediately.
3. For each tool call: run permission check → (ask user if required) → execute → append result (truncated to a size budget) → loop.
4. Stop on final assistant message or step/token cap (default 50 tool calls per turn).
5. Compaction: when history exceeds ~70% of the model's context window, summarise older turns with the small model and keep the last N turns verbatim.

### Tools (MVP)

| Tool | Permission default | Implementation |
|---|---|---|
| `list_directory`, `read_file`, `glob`, `grep` | Auto-allow inside workspace root | fs, `fast-glob`, `@vscode/ripgrep`; refuse paths outside the workspace and follow `.gitignore` |
| `edit_file` (exact search/replace), `write_file` | **Ask** — show Monaco diff, Accept / Reject / Accept-all-for-session | Write only after approval; snapshot original for one-click undo |
| `run_command` | **Ask** — show command + cwd; deny-list (`rm -rf /`, `format`, `git push --force`, etc.) | `node-pty`, 120 s default timeout, output capped at ~30 KB with head/tail, stdout streamed to xterm pane |
| `git_status` / `git_diff` | Auto-allow | Thin wrappers over `run_command` for common reads |

Permission modes selectable per session: **Ask (default)**, **Auto-accept edits**, **Plan only** (no writes, no commands).

### Voice input
- Azure Speech SDK (`microsoft-cognitiveservices-speech-sdk`) in the renderer; **push-to-talk** button and global hotkey (e.g. `Ctrl+Shift+Space`).
- Gateway issues 10-minute Speech tokens so the Speech key stays server-side.
- Phrase list seeded with project identifiers (file names, class names from the workspace) to improve recognition of code terms; transcript is placed in the composer for review before sending.

### Identity, security, usage
- **Entra ID**: app registration for the desktop (public client, auth-code + PKCE via system browser using `@azure/msal-node`), and one for the gateway API (exposes scope `access_as_user`). Access gated by an Entra group (`AIriel-Users`).
- Refresh tokens stored with Electron `safeStorage` (DPAPI on Windows).
- Gateway validates JWT (issuer, audience, group claim) on every request.
- **Usage table** (`Usage`): `UserId, UserName, ConversationId, Model, PromptTokens, CompletionTokens, CachedTokens, ToolCalls, LatencyMs, CreatedAt`. Cost is computed at report time from a `ModelPricing` table so price changes need no code change.
- Optional per-user daily token budget enforced in the gateway (soft warn, hard stop).
- Telemetry (App Insights) for errors and performance only; **no prompt or file content is logged** by default.

---

## Repository layout

```
AIriel/
  apps/desktop/           Electron + React app (electron-vite)
  packages/agent-core/    agent loop, permissions, compaction
  packages/tools/         fs / grep / edit / pty tools
  packages/protocol/      zod schemas shared by all
  services/gateway/       Fastify API + admin page
  infra/                  Bicep, GitHub Actions workflows
  docs/                   ADRs, architecture, onboarding
  pnpm-workspace.yaml, turbo.json, .github/workflows/
```

Tooling: pnpm workspaces + Turborepo, ESLint + Prettier, Vitest (unit), Playwright (Electron E2E), `electron-builder` for signed installers, `electron-updater` publishing to Azure Blob Storage.

---

## Roadmap (12 weeks to pilot)

### Phase 0 — Foundation (weeks 1–2)
- Create repo, monorepo scaffold, CI building all packages.
- Electron shell: window, workspace folder picker, empty chat pane, dark/light theme.
- Azure: Foundry project + two model deployments, Container App, Azure SQL, Speech resource, App Insights, Entra app registrations (Bicep).
- Gateway: JWT validation, `/v1/chat` streaming passthrough to Foundry, usage row written per call.
- Desktop SSO end to end (login → token → gateway → model reply appears in UI).
- **Exit criteria**: a signed-in user types "hello" and receives a streamed reply through the gateway; usage row exists in SQL.

### Phase 1 — Chat + read/search codebase (weeks 3–4)
- `agent-core` loop with tool calling; read-only tools; workspace-root confinement.
- Streaming markdown with code blocks (copy button), tool-call cards showing what was read/searched.
- Conversation persistence (SQLite via `better-sqlite3`), sidebar of past chats, auto titles.
- `AIRIEL.md` project instructions support.
- **Exit criteria**: "Explain how X works in this repo" answers correctly on Accor DMR-sized codebases; unit tests for loop, permissions, path confinement.

### Phase 2 — Edits with diff review (weeks 5–6)
- `edit_file` / `write_file` tools, Monaco side-by-side diff, Accept / Reject / Accept-all.
- Per-turn snapshot + "Undo this turn" button.
- Permission modes (Ask / Auto-accept edits / Plan only).
- **Exit criteria**: "Add a null check in method Y and a unit test" produces reviewed, applied edits; rejected edits leave disk untouched.

### Phase 3 — Terminal commands (week 7)
- `run_command` via `node-pty`, approval dialog, deny-list, timeout, output capping, xterm pane.
- Model receives exit code + truncated output and iterates (build → fix → rebuild).
- **Exit criteria**: "Run the tests and fix failures" loop works on a sample repo.

### Phase 4 — Voice input (week 8)
- Speech token endpoint, push-to-talk + hotkey, live partial transcript, phrase list from workspace symbols.
- **Exit criteria**: dictated request lands in composer with ≥ 90% accuracy on code terms in a quiet room.

### Phase 5 — Usage dashboard & admin (weeks 9–10)
- Admin page: tokens/cost by user, team, day, model; CSV export.
- Per-user budgets; admin group in Entra.
- Prompt-version and model-deployment switching from gateway config.
- **Exit criteria**: finance/leads can see monthly spend per developer.

### Phase 6 — Hardening & pilot (weeks 11–12)
- Code-signed installer, auto-update channel, crash reporting, onboarding doc.
- Security review: path traversal, command injection surface, token storage, log redaction.
- Pilot with 5–8 developers; collect feedback; fix top issues.
- **Exit criteria**: pilot group uses AI'riel daily for two weeks with no P1 bugs.

### Post-MVP backlog (prioritise with pilot feedback)
- MCP client support (connect internal tools: Jira, Azure DevOps, databases).
- Text-to-speech read-back of summaries; realtime voice later.
- RAG over internal docs/standards via Foundry + Azure AI Search.
- VS Code extension reusing `agent-core`.
- Team-shared prompts/skills, saved "slash commands".
- Background/long-running tasks and multi-file refactor planning mode.

---

## Team & effort (indicative)

| Role | Allocation |
|---|---|
| Lead full-stack TS engineer (Electron + agent-core) | 100% |
| Backend/cloud engineer (gateway, Bicep, Entra, SQL) | 50–100% |
| UX/front-end (chat UI, diff/approval UX, voice UX) | 50% |
| Product owner / pilot coordinator | 20% |

## Key risks & mitigations

| Risk | Mitigation |
|---|---|
| Model quality for agentic coding varies by Foundry model | `ModelProvider` abstraction; evaluate 2–3 deployments on a fixed task set in Phase 1 |
| Destructive edits/commands | Approval by default, deny-list, workspace confinement, per-turn undo |
| Cost overruns | Usage logging from day 1, budgets, cheap model for side tasks, prompt caching where the model supports it |
| Foundry quota/rate limits | Provisioned throughput or multiple deployments with gateway failover |
| Voice accuracy on code vocabulary | Phrase lists, transcript editable before send |
| Electron app size / security | Context isolation on, no `nodeIntegration` in renderer, all privileged work in main via typed IPC |

---

## Verification

- **Unit**: Vitest on `agent-core` (loop termination, tool-call parsing, permission decisions, path confinement, compaction thresholds) and `tools` (edit exactness, deny-list, output capping).
- **Gateway**: integration tests with a mocked Foundry endpoint (JWT rejected/accepted, streaming passthrough, usage row written).
- **E2E**: Playwright-Electron scenario per phase exit criterion above, run against a fixture repo.
- **Manual pilot checklist**: sign in, open folder, ask a question, accept an edit, reject an edit, run a build, dictate a prompt, confirm usage row.

## First implementation steps (once approved)

1. Create the new repo and pnpm/Turborepo monorepo with the layout above; add ESLint/Prettier/Vitest and a CI workflow.
2. Scaffold `apps/desktop` with `electron-vite` + React, context isolation, typed IPC, folder picker.
3. Scaffold `services/gateway` (Fastify, JWT validation, `/v1/chat` streaming passthrough, `Usage` insert) and `infra/` Bicep for Foundry, Container App, SQL, Speech, App Insights.
4. Register the two Entra applications and wire MSAL login in the desktop main process.
5. Write `docs/ADR-001-architecture.md` capturing the decisions in this plan.
