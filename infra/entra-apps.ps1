<#
.SYNOPSIS
  Creates the two Entra ID app registrations AI'riel needs and prints the values
  for the gateway (.env / Bicep params) and the desktop (airiel.config.json).

  1. AI'riel Gateway API  — exposes scope access_as_user, emits group claims
  2. AI'riel Desktop      — public client, redirect http://localhost (MSAL loopback)

.NOTES
  Requires: az login as a user who can create app registrations.
#>
param(
  [string] $Env = 'dev',
  [string] $UsersGroupName = 'AIriel-Users',
  [string] $AdminsGroupName = 'AIriel-Admins'
)
$ErrorActionPreference = 'Stop'

$tenant = az account show --query tenantId -o tsv

# --- API app ---
$apiName = "AI'riel Gateway API ($Env)"
$api = az ad app create --display-name $apiName --sign-in-audience AzureADMyOrg -o json | ConvertFrom-Json
$apiId = $api.appId
az ad app update --id $apiId --identifier-uris "api://$apiId" | Out-Null

$scopeId = [guid]::NewGuid().Guid
$apiBody = @{
  api = @{
    oauth2PermissionScopes = @(@{
      id = $scopeId; type = 'User'; value = 'access_as_user'; isEnabled = $true
      adminConsentDisplayName = "Access AI'riel Gateway"; adminConsentDescription = "Allows the app to call the AI'riel Gateway on behalf of the signed-in user"
      userConsentDisplayName = "Access AI'riel"; userConsentDescription = "Allows AI'riel to call its gateway on your behalf"
    })
    requestedAccessTokenVersion = 2
  }
  groupMembershipClaims = 'SecurityGroup'
  optionalClaims = @{ accessToken = @(@{ name = 'groups' }) }
} | ConvertTo-Json -Depth 6 -Compress
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$($api.id)" --headers 'Content-Type=application/json' --body $apiBody | Out-Null
az ad sp create --id $apiId 2>$null | Out-Null

# --- Desktop app ---
$deskName = "AI'riel Desktop ($Env)"
$desk = az ad app create --display-name $deskName --sign-in-audience AzureADMyOrg --is-fallback-public-client true -o json | ConvertFrom-Json
$deskId = $desk.appId
$deskBody = @{
  publicClient = @{ redirectUris = @('http://localhost') }
  requiredResourceAccess = @(@{ resourceAppId = $apiId; resourceAccess = @(@{ id = $scopeId; type = 'Scope' }) })
} | ConvertTo-Json -Depth 6 -Compress
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$($desk.id)" --headers 'Content-Type=application/json' --body $deskBody | Out-Null
az ad sp create --id $deskId 2>$null | Out-Null

# Pre-authorize the desktop client on the API so users don't see a consent prompt.
$preAuth = @{ api = @{ preAuthorizedApplications = @(@{ appId = $deskId; delegatedPermissionIds = @($scopeId) }) } } | ConvertTo-Json -Depth 6 -Compress
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$($api.id)" --headers 'Content-Type=application/json' --body $preAuth | Out-Null

# --- Groups ---
function Ensure-Group($name) {
  $g = az ad group list --display-name $name --query '[0].id' -o tsv
  if (-not $g) { $g = az ad group create --display-name $name --mail-nickname ($name -replace '[^a-zA-Z0-9]', '') --query id -o tsv }
  return $g
}
$usersGroup = Ensure-Group $UsersGroupName
$adminsGroup = Ensure-Group $AdminsGroupName

Write-Host ""
Write-Host "=== Gateway (.env / Bicep) ===" -ForegroundColor Cyan
Write-Host "ENTRA_TENANT_ID=$tenant"
Write-Host "ENTRA_API_CLIENT_ID=$apiId"
Write-Host "ENTRA_USERS_GROUP_ID=$usersGroup"
Write-Host "ENTRA_ADMINS_GROUP_ID=$adminsGroup"
Write-Host ""
Write-Host "=== Desktop (airiel.config.json) ===" -ForegroundColor Cyan
@{ entraTenantId = $tenant; entraClientId = $deskId; gatewayScope = "api://$apiId/access_as_user"; gatewayUrl = 'https://REPLACE-with-gateway-url' } | ConvertTo-Json
Write-Host ""
Write-Host "Add pilot developers to the '$UsersGroupName' group; admins to '$AdminsGroupName'." -ForegroundColor Yellow
