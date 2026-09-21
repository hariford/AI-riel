// Azure AI Foundry (AI Services account) with two model deployments.
param name string
param location string
param tags object
param defaultModel object
param smallModel object

resource account 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' = {
  name: 'aif-${name}'
  location: location
  tags: tags
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: 'aif-${name}'
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
    allowProjectManagement: true
  }
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-04-01-preview' = {
  parent: account
  name: 'proj-${name}'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: { displayName: 'AI\'riel ${name}' }
}

resource defaultDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-04-01-preview' = {
  parent: account
  name: defaultModel.name
  sku: { name: 'GlobalStandard', capacity: defaultModel.capacity }
  properties: {
    model: { format: 'OpenAI', name: defaultModel.name, version: defaultModel.version }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

resource smallDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-04-01-preview' = {
  parent: account
  name: smallModel.name
  sku: { name: 'GlobalStandard', capacity: smallModel.capacity }
  properties: {
    model: { format: 'OpenAI', name: smallModel.name, version: smallModel.version }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
  dependsOn: [defaultDeployment] // deployments must be created sequentially
}

output accountName string = account.name
output endpoint string = 'https://${account.properties.customSubDomainName}.openai.azure.com/'
output defaultDeployment string = defaultDeployment.name
output smallDeployment string = smallDeployment.name
