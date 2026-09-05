import crypto from "node:crypto";
import { CodeChallengeMethod, generateCodeVerifier, generateState, OAuth2Client } from "arctic";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getDb } from "../database/connection";
import { getEnv } from "../utils/env";
import { hashPassword } from "../utils/password";
import { logActivity } from "./activity.service";

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface OidcUserInfo {
  subject: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

export interface OidcAuthStart {
  url: string;
  state: string;
  codeVerifier: string;
  nonce: string;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 10_000;

interface DiscoveryCacheEntry {
  doc: OidcDiscoveryDocument;
  fetchedAt: number;
}

let discoveryCache: DiscoveryCacheEntry | null = null;
let jwksCache: { uri: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;

export function resetOidcServiceForTesting(): void {
  discoveryCache = null;
  jwksCache = null;
}

export async function discoverOidc(): Promise<OidcDiscoveryDocument> {
  if (discoveryCache && Date.now() - discoveryCache.fetchedAt < DISCOVERY_TTL_MS) {
    return discoveryCache.doc;
  }
  const env = getEnv();
  const url = `${env.OIDC_ISSUER_URL}/.well-known/openid-configuration`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
  }
  const text = await res.text();
  if (text.length > 1024 * 1024) {
    throw new Error("OIDC discovery document too large");
  }
  const raw = JSON.parse(text) as Record<string, unknown>;
  const missing = (
    ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"] as const
  ).filter((k) => typeof raw[k] !== "string" || raw[k] === "");
  if (missing.length > 0) {
    throw new Error(`OIDC discovery document missing fields: ${missing.join(", ")}`);
  }
  const doc: OidcDiscoveryDocument = {
    issuer: raw.issuer as string,
    authorization_endpoint: raw.authorization_endpoint as string,
    token_endpoint: raw.token_endpoint as string,
    jwks_uri: raw.jwks_uri as string,
  };
  if (doc.issuer.replace(/\/+$/, "") !== env.OIDC_ISSUER_URL) {
    throw new Error("OIDC discovery issuer mismatch");
  }
  discoveryCache = { doc, fetchedAt: Date.now() };
  return doc;
}

export function oidcScopes(): string[] {
  const scopes = getEnv()
    .OIDC_SCOPE.split(" ")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!scopes.includes("openid")) scopes.unshift("openid");
  return scopes;
}

export function buildOidcAuthorizationUrl(
  doc: OidcDiscoveryDocument,
  redirectUri: string,
): OidcAuthStart {
  const env = getEnv();
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const nonce = crypto.randomBytes(16).toString("hex");
  const client = new OAuth2Client(env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET, redirectUri);
  const url = client.createAuthorizationURLWithPKCE(
    doc.authorization_endpoint,
    state,
    CodeChallengeMethod.S256,
    codeVerifier,
    oidcScopes(),
  );
  url.searchParams.set("nonce", nonce);
  return { url: url.toString(), state, codeVerifier, nonce };
}

/**
 * Verifies an id_token against the discovered JWKS and the configured
 * issuer/client, then checks the nonce binding. Throws on any mismatch.
 */
export async function validateIdToken(idToken: string, nonce: string): Promise<OidcUserInfo> {
  const env = getEnv();
  const doc = await discoverOidc();
  if (!jwksCache || jwksCache.uri !== doc.jwks_uri) {
    jwksCache = { uri: doc.jwks_uri, set: createRemoteJWKSet(new URL(doc.jwks_uri)) };
  }
  const { payload } = await jwtVerify(idToken, jwksCache.set, {
    // getEnv normalizes the configured URL, but providers such as Authentik
    // publish a scoped issuer with a trailing slash in the discovery document
    // and id_token. Accept both equivalent wire representations.
    issuer: [env.OIDC_ISSUER_URL, `${env.OIDC_ISSUER_URL}/`],
    audience: env.OIDC_CLIENT_ID,
  });
  if (payload.nonce !== nonce) {
    throw new Error("OIDC id_token nonce mismatch");
  }
  const subject = typeof payload.sub === "string" ? payload.sub : "";
  const email =
    typeof (payload as { email?: unknown }).email === "string"
      ? (payload as { email: string }).email
      : "";
  if (!subject || !email) {
    throw new OidcLoginError("email_required", "OIDC id_token missing sub/email");
  }
  const ev = (payload as { email_verified?: unknown }).email_verified;
  const name =
    typeof (payload as { name?: unknown }).name === "string"
      ? (payload as { name: string }).name
      : "";
  return {
    subject,
    email,
    name,
    emailVerified: ev === true || ev === "true",
  };
}

// Test seam: replaces the arctic token-exchange portion so route tests can
// exercise the callback without network calls.
type CallbackOverride = (code: string, codeVerifier: string | undefined) => Promise<OidcUserInfo>;

let callbackOverride: CallbackOverride | null = null;

export function setOidcCallbackOverride(fn: CallbackOverride | null): void {
  callbackOverride = fn;
}

/**
 * Authorization-code exchange: arctic talks to the discovered token endpoint
 * (Basic auth, PKCE verifier, redirect_uri), then the id_token is validated
 * by validateIdToken.
 */
export async function exchangeOidcCode(
  doc: OidcDiscoveryDocument,
  code: string,
  codeVerifier: string | undefined,
  nonce: string,
  redirectUri: string,
): Promise<OidcUserInfo> {
  if (callbackOverride) return callbackOverride(code, codeVerifier);
  const env = getEnv();
  const client = new OAuth2Client(env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET, redirectUri);
  // The token-endpoint response is not size-capped: arctic owns the fetch and
  // it cannot be intercepted without replacing arctic's client.
  const tokens = await client.validateAuthorizationCode(
    doc.token_endpoint,
    code,
    codeVerifier ?? null,
  );
  return validateIdToken(tokens.idToken(), nonce);
}

export type OidcErrorCode =
  | "email_required"
  | "unverified_email"
  | "domain_not_allowed"
  | "provisioning_disabled"
  | "user_inactive"
  | "auth_failed";

export class OidcLoginError extends Error {
  constructor(
    readonly code: OidcErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface OidcResolution {
  userId: string;
  username: string;
  isAdmin: boolean;
  outcome: "existing" | "linked" | "provisioned";
}

type UserRow = {
  id: string;
  username: string;
  is_admin: number;
  is_active: number;
};

function assertActive(row: UserRow): void {
  if (!row.is_active) {
    throw new OidcLoginError("user_inactive", "User is deactivated");
  }
}

async function freeUsername(email: string): Promise<string> {
  const db = getDb();
  const candidates = [email];
  for (let n = 2; n <= 11; n++) candidates.push(`${email}-${n}`);
  for (const candidate of candidates) {
    const taken = db.query("SELECT id FROM users WHERE username = ?").get(candidate);
    if (!taken) return candidate;
  }
  return `${email}-${crypto.randomBytes(3).toString("hex")}`;
}

export async function resolveOrProvisionUser(
  issuer: string,
  info: OidcUserInfo,
): Promise<OidcResolution> {
  const db = getDb();

  // 1. Existing SSO identity.
  const byIdentity = db
    .query(
      "SELECT id, username, is_admin, is_active FROM users WHERE oidc_issuer = ? AND oidc_subject = ?",
    )
    .get(issuer, info.subject) as UserRow | null;
  if (byIdentity) {
    assertActive(byIdentity);
    return {
      userId: byIdentity.id,
      username: byIdentity.username,
      isAdmin: !!byIdentity.is_admin,
      outcome: "existing",
    };
  }

  // 2. Verified-email link to an existing account (nOAuth: never link an
  //    email the provider does not attest).
  if (info.emailVerified) {
    const byEmail = db
      .query(
        "SELECT id, username, is_admin, is_active FROM users WHERE lower(email) = lower(?) AND oidc_issuer IS NULL",
      )
      .get(info.email) as UserRow | null;
    if (byEmail) {
      assertActive(byEmail);
      db.run(
        "UPDATE users SET oidc_issuer = ?, oidc_subject = ?, updated_at = datetime('now') WHERE id = ?",
        [issuer, info.subject, byEmail.id],
      );
      return {
        userId: byEmail.id,
        username: byEmail.username,
        isAdmin: !!byEmail.is_admin,
        outcome: "linked",
      };
    }
  }

  // 3. JIT provisioning — Viewer only, gated by flag + optional domain list.
  const env = getEnv();
  if (!env.OIDC_AUTO_PROVISION) {
    throw new OidcLoginError("provisioning_disabled", "JIT provisioning is disabled");
  }
  const domain = info.email.includes("@") ? info.email.split("@")[1]!.toLowerCase() : "";
  if (env.OIDC_ALLOWED_DOMAINS.length > 0 && !env.OIDC_ALLOWED_DOMAINS.includes(domain)) {
    throw new OidcLoginError("domain_not_allowed", "Email domain not allowed");
  }

  const username = await freeUsername(info.email);
  const id = crypto.randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(crypto.randomBytes(24).toString("base64url"));
  db.transaction(() => {
    db.run(
      `INSERT INTO users (id, username, email, display_name, password_hash, is_admin, is_active, role, oidc_issuer, oidc_subject)
       VALUES (?, ?, ?, ?, ?, 0, 1, 'Viewer', ?, ?)`,
      [id, username, info.email, info.name || null, passwordHash, issuer, info.subject],
    );
  })();
  logActivity({
    user_id: id,
    user_name: username,
    action: "user_created",
    resource_type: "user",
    resource_id: id,
  });
  return { userId: id, username, isAdmin: false, outcome: "provisioned" };
}
