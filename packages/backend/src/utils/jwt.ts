import { sign, verify } from "hono/jwt";
import { getEnv } from "./env";

// Bumped when the JWT shape changes in a way that requires forcing all clients
// to re-login (e.g. introducing tenant_id binding). Tokens with v < CURRENT
// are rejected by authMiddleware.
export const CURRENT_JWT_VERSION = 1;

export interface JWTPayload {
  sub: string;
  username: string;
  is_admin: boolean;
  /**
   * Workspace ID the token was issued for; set in multi-tenant deployments.
   * authMiddleware cross-checks this against the resolved tenant on the
   * request to prevent cross-tenant token replay.
   */
  tenant_id?: string;
  /**
   * Ops identity that minted this token via the impersonation flow. Present
   * only on impersonation tokens. Auditable. Surfaced to the UI as a banner.
   */
  impersonator_id?: string;
  /** Free-form reason logged at mint time (e.g. "support ticket #1234"). */
  impersonation_reason?: string;
  /** Token schema version. See CURRENT_JWT_VERSION. */
  v: number;
  exp: number;
}

export type SignableJWTPayload = Omit<JWTPayload, "exp" | "v"> & { v?: number };

export async function signToken(payload: SignableJWTPayload): Promise<string> {
  const env = getEnv();
  const exp = Math.floor(Date.now() / 1000) + env.SESSION_TTL;
  const fullPayload = {
    ...payload,
    v: payload.v ?? CURRENT_JWT_VERSION,
    exp,
  };
  return sign(fullPayload, env.JWT_SECRET, "HS256");
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const env = getEnv();
  const payload = (await verify(token, env.JWT_SECRET, "HS256")) as unknown as JWTPayload;
  return payload;
}
