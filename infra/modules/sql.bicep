param name string
param location string
param tags object
param adminLogin string
@secure()
param adminPassword string

resource server 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: 'sql-${name}'
  location: location
  tags: tags
  properties: {
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource allowAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: server
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource db 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: server
  name: 'airiel'
  location: location
  tags: tags
  sku: { name: 'Basic', tier: 'Basic' }
}

#disable-next-line outputs-should-not-contain-secrets // consumed only by the container app secret
output connectionString string = 'Server=tcp:${server.properties.fullyQualifiedDomainName},1433;Database=${db.name};User ID=${adminLogin};Password=${adminPassword};Encrypt=true;TrustServerCertificate=false;'
