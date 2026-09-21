# AI'riel — developer onboarding

## Prerequisites

- Node 22+ and pnpm 12 (`npm i -g pnpm`)
- Azure CLI (`az`) signed in to the company tenant, with Bicep (`az bicep install`)
- Windows: Visual Studio Build Tools are **not** required for the current dependency set

## 1. Build and test locally

```powershell
pnpm install
pnpm build
pnpm test
```

## 2. Azure resources (once per environment)

```powershell
# App registrations + groups; prints the values used below
./infra/entra-apps.ps1 -Env dev

$env:AIRIEL_TENANT_ID = '<tenant>'; $env:AIRIEL_API_CLIENT_ID = '<api app id>'
$env:AIRIEL_USERS_GROUP_ID = '<group>'; $env:AIRIEL_ADMINS_GROUP_ID = '<group>'
$env:AIRIEL_SQL_PASSWORD = '<strong password>'
az group create -n rg-airiel-dev -l australiaeast
az deployment group create -g rg-airiel-dev -f infra/main.bicep -p infra/main.dev.bicepparam
```

Then apply `services/gateway/sql/schema.sql` to the `airiel` database and insert current prices
into `dbo.ModelPricing`.

## 3. Gateway

Local: copy `services/gateway/.env.example` to `.env`, set `FOUNDRY_ENDPOINT` (and either
`FOUNDRY_API_KEY` or stay signed in with `az login` for `DefaultAzureCredential`), then `pnpm dev:gateway`.

Azure: build and push the image, then redeploy with `AIRIEL_GATEWAY_IMAGE` set:

```powershell
az acr build -r <acr> -t airiel-gateway:$(git rev-parse --short HEAD) -f services/gateway/Dockerfile .
```

## 4. Desktop

Create `airiel.config.json` next to the executable (or in `%APPDATA%/airiel/`) with the values the
Entra script printed:

```json
{ "gatewayUrl": "https://ca-airiel-dev-gateway.<region>.azurecontainerapps.io", "entraTenantId": "...", "entraClientId": "...", "gatewayScope": "api://<api-id>/access_as_user" }
```

For local development against a gateway running with `AUTH_DISABLED=true`:

```powershell
$env:AIRIEL_AUTH_DISABLED = 'true'; $env:AIRIEL_GATEWAY_URL = 'http://localhost:8080'
pnpm dev:desktop
```

## 5. Project instructions for a repo

Put an `AIRIEL.md` at the root of any repository. Its contents are added to the system prompt
(build commands, conventions, gotchas) — the same idea as a `CLAUDE.md`.

## Where things are

| Concern | Location |
|---|---|
| Agent loop / permissions | `packages/agent-core/src` |
| Tools and deny-list | `packages/tools/src` |
| Gateway routes | `services/gateway/src/routes` |
| Desktop main (auth, IPC) | `apps/desktop/src/main` |
| Chat UI | `apps/desktop/src/renderer/src` |
| Infra | `infra/` |
