param name string
param location string
param tags object

resource speech 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'spch-${name}'
  location: location
  tags: tags
  kind: 'SpeechServices'
  sku: { name: 'S0' }
  properties: { customSubDomainName: 'spch-${name}', publicNetworkAccess: 'Enabled' }
}

#disable-next-line outputs-should-not-contain-secrets // consumed only by the container app secret
output key string = speech.listKeys().key1
