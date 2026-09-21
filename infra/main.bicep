// AI'riel infrastructure. Deploy with:
//   az deployment group create -g rg-airiel-dev -f infra/main.bicep -p infra/main.dev.bicepparam
targetScope = 'resourceGroup'

@description('Short environment name: dev | test | prod')
param env string = 'dev'
@description('Azure region for all resources')
param location string = resourceGroup().location
@description('Prefix for resource names')
param prefix string = 'airiel'

@description('Entra tenant id used by the gateway to validate tokens')
param entraTenantId string
@description('Application (client) id of the gateway API app registration')
param entraApiClientId string
@description('Object id of the Entra group allowed to use AI\'riel (empty = whole tenant)')
param entraUsersGroupId string = ''
@description('Object id of the Entra group allowed to see org-wide usage')
param entraAdminsGroupId string = ''

@description('Container image for the gateway, e.g. myacr.azurecr.io/airiel-gateway:1.0.0')
param gatewayImage string
@description('Default (coding) model to deploy in Foundry')
param defaultModel object = { name: 'gpt-4.1', version: '2025-04-14', capacity: 50 }
@description('Small model for titles/compaction')
param smallModel object = { name: 'gpt-4.1-mini', version: '2025-04-14', capacity: 50 }

@secure()
param sqlAdminPassword string
param sqlAdminLogin string = 'airieladmin'

var name = '${prefix}-${env}'
var tags = { app: 'airiel', env: env }

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: { name: name, location: location, tags: tags }
}

module foundry 'modules/foundry.bicep' = {
  name: 'foundry'
  params: {
    name: name
    location: location
    tags: tags
    defaultModel: defaultModel
    smallModel: smallModel
  }
}

module speech 'modules/speech.bicep' = {
  name: 'speech'
  params: { name: name, location: location, tags: tags }
}

module sql 'modules/sql.bicep' = {
  name: 'sql'
  params: {
    name: name
    location: location
    tags: tags
    adminLogin: sqlAdminLogin
    adminPassword: sqlAdminPassword
  }
}

module gateway 'modules/containerapp.bicep' = {
  name: 'gateway'
  params: {
    name: name
    location: location
    tags: tags
    image: gatewayImage
    logAnalyticsId: monitoring.outputs.logAnalyticsId
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    foundryEndpoint: foundry.outputs.endpoint
    foundryAccountName: foundry.outputs.accountName
    defaultDeployment: foundry.outputs.defaultDeployment
    smallDeployment: foundry.outputs.smallDeployment
    speechRegion: location
    speechKey: speech.outputs.key
    sqlConnectionString: sql.outputs.connectionString
    entraTenantId: entraTenantId
    entraApiClientId: entraApiClientId
    entraUsersGroupId: entraUsersGroupId
    entraAdminsGroupId: entraAdminsGroupId
  }
}

output gatewayUrl string = gateway.outputs.url
output foundryEndpoint string = foundry.outputs.endpoint
