import { app } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Desktop configuration. Resolution order:
 *   1. environment variables (AIRIEL_*), handy for dev
 *   2. airiel.config.json next to the executable (IT can pre-provision it)
 *   3. defaults
 */
const Schema = z.object({
  gatewayUrl: z.string().url().default('http://localhost:8080'),
  entraTenantId: z.string().default('common'),
  /** Public client (desktop) app registration id. */
  entraClientId: z.string().default(''),
  /** Scope exposed by the gateway API registration, e.g. api://<api-client-id>/access_as_user */
  gatewayScope: z.string().default(''),
  /** Dev only: skip sign-in and send no bearer token (gateway must run with AUTH_DISABLED). */
  authDisabled: z.boolean().default(false),
});
export type DesktopConfig = z.infer<typeof Schema>;

export function loadDesktopConfig(): DesktopConfig {
  let fileCfg: Record<string, unknown> = {};
  for (const dir of [path.dirname(app.getPath('exe')), app.getPath('userData')]) {
    try {
      fileCfg = { ...fileCfg, ...JSON.parse(readFileSync(path.join(dir, 'airiel.config.json'), 'utf8')) };
    } catch {
      /* optional */
    }
  }
  const env = process.env;
  return Schema.parse({
    ...fileCfg,
    ...(env['AIRIEL_GATEWAY_URL'] ? { gatewayUrl: env['AIRIEL_GATEWAY_URL'] } : {}),
    ...(env['AIRIEL_TENANT_ID'] ? { entraTenantId: env['AIRIEL_TENANT_ID'] } : {}),
    ...(env['AIRIEL_CLIENT_ID'] ? { entraClientId: env['AIRIEL_CLIENT_ID'] } : {}),
    ...(env['AIRIEL_GATEWAY_SCOPE'] ? { gatewayScope: env['AIRIEL_GATEWAY_SCOPE'] } : {}),
    ...(env['AIRIEL_AUTH_DISABLED'] ? { authDisabled: env['AIRIEL_AUTH_DISABLED'] === 'true' } : {}),
  });
}
