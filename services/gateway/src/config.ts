import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8080),
  /** Dev only: skip JWT validation and act as a fixed local user. Refused in production. */
  AUTH_DISABLED: bool,

  // Entra ID
  ENTRA_TENANT_ID: z.string().default(''),
  /** Application (client) ID of the gateway API app registration; used as the expected audience. */
  ENTRA_API_CLIENT_ID: z.string().default(''),
  /** Object ID of the Entra group that may use AI'riel. Empty = any signed-in tenant user. */
  ENTRA_USERS_GROUP_ID: z.string().default(''),
  /** Object ID of the Entra group that may read organisation-wide usage. */
  ENTRA_ADMINS_GROUP_ID: z.string().default(''),

  // Azure AI Foundry (Azure OpenAI-compatible endpoint)
  FOUNDRY_ENDPOINT: z.string().default(''),
  FOUNDRY_API_VERSION: z.string().default('2024-10-21'),
  /** Optional API key; when empty the gateway uses its managed identity (DefaultAzureCredential). */
  FOUNDRY_API_KEY: z.string().default(''),
  FOUNDRY_DEPLOYMENT_DEFAULT: z.string().default('gpt-4.1'),
  FOUNDRY_DEPLOYMENT_SMALL: z.string().default('gpt-4.1-mini'),
  FOUNDRY_CONTEXT_WINDOW: z.coerce.number().int().default(128_000),

  // Azure Speech. Either a standalone Speech resource (SPEECH_REGION + SPEECH_KEY), or the
  // Foundry / AI Services resource itself, which includes Speech: leave SPEECH_KEY empty and the
  // Foundry key is used against SPEECH_ENDPOINT (derived from FOUNDRY_ENDPOINT when empty).
  SPEECH_REGION: z.string().default(''),
  SPEECH_KEY: z.string().default(''),
  /** Custom-domain endpoint, e.g. https://<resource>.cognitiveservices.azure.com */
  SPEECH_ENDPOINT: z.string().default(''),

  // Usage store
  SQL_CONNECTION_STRING: z.string().default(''),

  /** Optional daily per-user token budget; 0 disables. */
  DAILY_TOKEN_BUDGET: z.coerce.number().int().default(0),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = ConfigSchema.parse(env);
  if (cfg.NODE_ENV === 'production' && cfg.AUTH_DISABLED) {
    throw new Error('AUTH_DISABLED is not allowed in production');
  }
  if (!cfg.AUTH_DISABLED && (!cfg.ENTRA_TENANT_ID || !cfg.ENTRA_API_CLIENT_ID)) {
    throw new Error('ENTRA_TENANT_ID and ENTRA_API_CLIENT_ID are required unless AUTH_DISABLED=true');
  }
  return cfg;
}
