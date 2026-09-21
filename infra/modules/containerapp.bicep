// AI'riel Gateway on Azure Container Apps, calling Foundry with its managed identity.
param name string
param location string
param tags object
param image string
param logAnalyticsId string
param appInsightsConnectionString string
param foundryEndpoint string
param foundryAccountName string
param defaultDeployment string
param smallDeployment string
param speechRegion string
@secure()
param speechKey string
@secure()
param sqlConnectionString string
param entraTenantId string
param entraApiClientId string
param entraUsersGroupId string
param entraAdminsGroupId string

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${name}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: reference(logAnalyticsId, '2023-09-01').customerId
        sharedKey: listKeys(logAnalyticsId, '2023-09-01').primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${name}-gateway'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: { external: true, targetPort: 8080, transport: 'auto', allowInsecure: false }
      secrets: [
        { name: 'speech-key', value: speechKey }
        { name: 'sql-connection-string', value: sqlConnectionString }
      ]
    }
    template: {
      containers: [
        {
          name: 'gateway'
          image: image
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '8080' }
            { name: 'ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'ENTRA_API_CLIENT_ID', value: entraApiClientId }
            { name: 'ENTRA_USERS_GROUP_ID', value: entraUsersGroupId }
            { name: 'ENTRA_ADMINS_GROUP_ID', value: entraAdminsGroupId }
            { name: 'FOUNDRY_ENDPOINT', value: foundryEndpoint }
            { name: 'FOUNDRY_DEPLOYMENT_DEFAULT', value: defaultDeployment }
            { name: 'FOUNDRY_DEPLOYMENT_SMALL', value: smallDeployment }
            { name: 'SPEECH_REGION', value: speechRegion }
            { name: 'SPEECH_KEY', secretRef: 'speech-key' }
            { name: 'SQL_CONNECTION_STRING', secretRef: 'sql-connection-string' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
          ]
          probes: [
            { type: 'Liveness', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 30 }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 5, rules: [{ name: 'http', http: { metadata: { concurrentRequests: '50' } } }] }
    }
  }
}

// Gateway identity may call the Foundry models: Cognitive Services OpenAI User.
resource foundryAccount 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' existing = {
  name: foundryAccountName
}

resource openAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, app.id, 'openai-user')
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output url string = 'https://${app.properties.configuration.ingress.fqdn}'
