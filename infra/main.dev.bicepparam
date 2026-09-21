using './main.bicep'

param env = 'dev'
param prefix = 'airiel'
param entraTenantId = readEnvironmentVariable('AIRIEL_TENANT_ID', '')
param entraApiClientId = readEnvironmentVariable('AIRIEL_API_CLIENT_ID', '')
param entraUsersGroupId = readEnvironmentVariable('AIRIEL_USERS_GROUP_ID', '')
param entraAdminsGroupId = readEnvironmentVariable('AIRIEL_ADMINS_GROUP_ID', '')
param gatewayImage = readEnvironmentVariable('AIRIEL_GATEWAY_IMAGE', 'mcr.microsoft.com/k8se/quickstart:latest')
param sqlAdminPassword = readEnvironmentVariable('AIRIEL_SQL_PASSWORD', '')
