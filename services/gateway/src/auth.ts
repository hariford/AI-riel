import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Config } from './config.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  groups: string[];
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

export interface Authenticator {
  (req: FastifyRequest, reply: FastifyReply): Promise<void>;
}

export const DEV_USER: AuthUser = {
  id: 'dev-user',
  name: 'Local Developer',
  email: 'dev@localhost',
  groups: [],
  isAdmin: true,
};

/** Builds the preHandler that validates Entra ID bearer tokens and populates req.user. */
export function createAuthenticator(cfg: Config): Authenticator {
  if (cfg.AUTH_DISABLED) {
    return async (req) => {
      req.user = DEV_USER;
    };
  }

  const issuer = `https://login.microsoftonline.com/${cfg.ENTRA_TENANT_ID}/v2.0`;
  const jwks = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${cfg.ENTRA_TENANT_ID}/discovery/v2.0/keys`),
  );
  const audiences = [cfg.ENTRA_API_CLIENT_ID, `api://${cfg.ENTRA_API_CLIENT_ID}`];

  return async (req, reply) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      reply.code(401).send({ error: 'missing bearer token' });
      return;
    }
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks, { issuer, audience: audiences }));
    } catch (err) {
      reply.code(401).send({ error: `invalid token: ${(err as Error).message}` });
      return;
    }
    const user = toUser(payload, cfg);
    if (cfg.ENTRA_USERS_GROUP_ID && !user.groups.includes(cfg.ENTRA_USERS_GROUP_ID)) {
      reply.code(403).send({ error: 'not a member of the AI\'riel users group' });
      return;
    }
    req.user = user;
  };
}

export function toUser(payload: JWTPayload, cfg: Pick<Config, 'ENTRA_ADMINS_GROUP_ID'>): AuthUser {
  const groups = Array.isArray(payload['groups']) ? (payload['groups'] as string[]) : [];
  const email = String(payload['preferred_username'] ?? payload['email'] ?? payload['upn'] ?? '');
  return {
    id: String(payload['oid'] ?? payload.sub ?? ''),
    name: String(payload['name'] ?? email),
    email,
    groups,
    isAdmin: Boolean(cfg.ENTRA_ADMINS_GROUP_ID) && groups.includes(cfg.ENTRA_ADMINS_GROUP_ID),
  };
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.user?.isAdmin) {
    reply.code(403).send({ error: 'admin group required' });
    return false;
  }
  return true;
}
