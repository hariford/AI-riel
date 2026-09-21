# ADR-001: AI'riel architecture

**Status:** Accepted · **Date:** 2026-09-21

## Context

Developers want a Claude-Desktop-style coding assistant that runs against the company's Azure
AI Foundry deployments, can operate on a local working directory, supports voice input, uses
company SSO and reports usage per user.

## Decisions

1. **Standalone Electron desktop app, TypeScript end to end.** Local file/terminal access needs a
   process on the developer's machine. Electron (over Tauri) because ripgrep, the Speech SDK and
   future `node-pty` are Node-native and mature. A shared `agent-core` keeps a VS Code extension
   possible later.
2. **All model traffic goes through an AI'riel Gateway in Azure**, never directly from the desktop.
   Foundry keys/identity stay server-side, usage is logged in one place, and models/prompts can be
   changed without shipping a new installer. The gateway is a thin Fastify service on Container
   Apps calling Foundry with its managed identity.
3. **Foundry's OpenAI-compatible chat completions API with function calling and streaming** via the
   `openai` client (`AzureOpenAI`). Logical model names (`default`, `small`) map to deployment names
   in gateway config so the model can be swapped or A/B tested.
4. **Permission model**: read tools auto-allowed inside the workspace root; edits and commands ask by
   default; modes *Ask / Auto-accept edits / Plan only*; a fixed deny-list refuses destructive
   commands even with approval; per-turn snapshots give one-click undo.
5. **Entra ID auth-code + PKCE** via the system browser (`@azure/msal-node`), tokens encrypted at rest
   with Electron `safeStorage`. Gateway validates JWTs and enforces group membership.
6. **Voice v1 = push-to-talk speech-to-text only**, Azure Speech SDK in the renderer with
   short-lived tokens from the gateway and workspace-derived phrase lists.
7. **No prompt or source content is logged** by gateway or telemetry; only token counts and timings.

## Consequences

- Two deployables (installer + container) and an Entra setup step before first use.
- Conversation history lives on the developer's machine (JSON now, SQLite later); nothing is stored
  server-side beyond usage rows.
- Electron installer size (~150 MB) accepted in exchange for ecosystem maturity.
