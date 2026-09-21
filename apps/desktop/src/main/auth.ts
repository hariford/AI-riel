import { app, safeStorage, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  PublicClientApplication,
  type AccountInfo,
  type ICachePlugin,
  type TokenCacheContext,
} from '@azure/msal-node';
import type { UserProfile } from '@airiel/protocol';
import type { DesktopConfig } from './config.js';

/**
 * Entra ID sign-in for the desktop app: auth-code + PKCE through the system
 * browser, tokens cached on disk encrypted with Electron safeStorage (DPAPI on Windows).
 */
export class AuthService {
  private readonly pca: PublicClientApplication;
  private readonly scopes: string[];
  private account: AccountInfo | null = null;

  constructor(private readonly cfg: DesktopConfig) {
    this.scopes = cfg.gatewayScope ? [cfg.gatewayScope] : [];
    this.pca = new PublicClientApplication({
      auth: {
        clientId: cfg.entraClientId,
        authority: `https://login.microsoftonline.com/${cfg.entraTenantId}`,
      },
      cache: { cachePlugin: encryptedCachePlugin(path.join(app.getPath('userData'), 'msal-cache.bin')) },
    });
  }

  get enabled(): boolean {
    return !this.cfg.authDisabled && Boolean(this.cfg.entraClientId);
  }

  async currentUser(): Promise<UserProfile | null> {
    if (!this.enabled) return { id: 'dev-user', name: 'Local Developer', email: 'dev@localhost' };
    if (!this.account) {
      const accounts = await this.pca.getTokenCache().getAllAccounts();
      this.account = accounts[0] ?? null;
    }
    return this.account ? toProfile(this.account) : null;
  }

  async signIn(): Promise<UserProfile> {
    if (!this.enabled) return (await this.currentUser())!;
    const result = await this.pca.acquireTokenInteractive({
      scopes: this.scopes,
      openBrowser: async (url) => {
        await shell.openExternal(url);
      },
      successTemplate: "<html><body style='font-family:sans-serif'><h2>Signed in to AI'riel</h2><p>You can close this tab and return to the app.</p></body></html>",
      errorTemplate: '<html><body><h2>Sign-in failed</h2><p>Return to AI\'riel and try again.</p></body></html>',
    });
    this.account = result.account;
    return toProfile(result.account!);
  }

  async signOut(): Promise<void> {
    if (!this.enabled) return;
    const cache = this.pca.getTokenCache();
    for (const acc of await cache.getAllAccounts()) await cache.removeAccount(acc);
    this.account = null;
  }

  /** Access token for the gateway; refreshes silently, falls back to interactive. */
  async getAccessToken(): Promise<string> {
    if (!this.enabled) return '';
    const user = await this.currentUser();
    if (!user || !this.account) throw new Error('Not signed in');
    try {
      const r = await this.pca.acquireTokenSilent({ account: this.account, scopes: this.scopes });
      return r.accessToken;
    } catch {
      const r = await this.pca.acquireTokenInteractive({
        scopes: this.scopes,
        openBrowser: async (url) => {
          await shell.openExternal(url);
        },
      });
      this.account = r.account;
      return r.accessToken;
    }
  }
}

function toProfile(a: AccountInfo): UserProfile {
  return { id: a.localAccountId, name: a.name ?? a.username, email: a.username };
}

/** MSAL cache persisted with OS-level encryption. */
function encryptedCachePlugin(file: string): ICachePlugin {
  return {
    async beforeCacheAccess(ctx: TokenCacheContext) {
      try {
        const buf = await fs.readFile(file);
        const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
        ctx.tokenCache.deserialize(json);
      } catch {
        /* first run */
      }
    },
    async afterCacheAccess(ctx: TokenCacheContext) {
      if (!ctx.cacheHasChanged) return;
      const json = ctx.tokenCache.serialize();
      const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data);
    },
  };
}
