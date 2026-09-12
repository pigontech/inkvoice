import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  buildOidcAuthorizationUrl,
  discoverOidc,
  exchangeOidcCode,
  oidcScopes,
  resetOidcServiceForTesting,
  validateIdToken,
} from "../services/oidc.service";
import { resetEnvCache } from "../utils/env";

const CLIENT_ID = "inkvoice-test";
const CLIENT_SECRET = "test-secret";
let issuer: string;
let server: ReturnType<typeof Bun.serve>;
let privateKey: CryptoKey;
let publicJwk: Record<string, unknown>;
let discoveryHits = 0;
let evilIssuer = false;
let trailingSlashIssuer = false;
let hugeDoc = false;
let nextIdToken = "";
let certDir: string | null = null;
let prevTlsRejectUnauthorized: string | undefined;

async function signIdToken(claims: Record<string, unknown>, tokenIssuer = issuer): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", kid: "test-kid" })
    .setIssuer(tokenIssuer)
    .setAudience(CLIENT_ID)
    .setSubject("sub-123")
    .setExpirationTime("5m")
    .sign(privateKey);
}

beforeAll(async () => {
  const { privateKey: pk, publicKey } = await generateKeyPair("ES256");
  privateKey = pk;
  publicJwk = { ...(await exportJWK(publicKey)), kid: "test-kid", alg: "ES256", use: "sig" };

  // The stub issuer must be https: env.ts rejects any non-https
  // OIDC_ISSUER_URL, so serve it over TLS with a throwaway self-signed cert
  // and disable certificate verification for this test process.
  certDir = mkdtempSync(join(tmpdir(), "inkvoice-oidc-"));
  const certPath = join(certDir, "cert.pem");
  const keyPath = join(certDir, "key.pem");
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "pipe" },
  );
  if (result.status !== 0) {
    throw new Error(`openssl cert generation failed: ${result.stderr?.toString()}`);
  }

  server = Bun.serve({
    port: 0,
    tls: {
      cert: await Bun.file(certPath).text(),
      key: await Bun.file(keyPath).text(),
    },
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/openid-configuration") {
        discoveryHits++;
        if (hugeDoc) {
          return Response.json("x".repeat(1100 * 1024));
        }
        return Response.json({
          issuer: evilIssuer
            ? "https://evil.example.com"
            : trailingSlashIssuer
              ? `${issuer}/`
              : issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      }
      if (url.pathname === "/jwks") return Response.json({ keys: [publicJwk] });
      if (url.pathname === "/token") return Response.json({ id_token: nextIdToken });
      return new Response("not found", { status: 404 });
    },
  });
  issuer = `https://127.0.0.1:${server.port}`;

  process.env.OIDC_ISSUER_URL = issuer;
  process.env.OIDC_CLIENT_ID = CLIENT_ID;
  process.env.OIDC_CLIENT_SECRET = CLIENT_SECRET;
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  prevTlsRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  resetEnvCache();
});

afterAll(() => {
  server.stop(true);
  resetOidcServiceForTesting();
  delete process.env.OIDC_ISSUER_URL;
  delete process.env.OIDC_CLIENT_ID;
  delete process.env.OIDC_CLIENT_SECRET;
  delete process.env.OIDC_SCOPE;
  resetEnvCache();
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (prevTlsRejectUnauthorized !== undefined) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTlsRejectUnauthorized;
  }
  if (certDir) rmSync(certDir, { recursive: true, force: true });
});

describe("discovery", () => {
  test("fetches and validates the discovery document", async () => {
    resetOidcServiceForTesting();
    const doc = await discoverOidc();
    expect(doc.issuer).toBe(issuer);
    expect(doc.authorization_endpoint).toBe(`${issuer}/authorize`);
    expect(doc.token_endpoint).toBe(`${issuer}/token`);
    expect(doc.jwks_uri).toBe(`${issuer}/jwks`);
  });

  test("caches the document for one hour (no refetch)", async () => {
    resetOidcServiceForTesting();
    discoveryHits = 0;
    await discoverOidc();
    await discoverOidc();
    expect(discoveryHits).toBe(1);
  });

  test("rejects a document whose issuer does not match the configured issuer", async () => {
    resetOidcServiceForTesting();
    evilIssuer = true;
    await expect(discoverOidc()).rejects.toThrow();
    evilIssuer = false;
    resetOidcServiceForTesting();
  });

  test("accepts a document whose issuer has a trailing slash", async () => {
    resetOidcServiceForTesting();
    trailingSlashIssuer = true;
    const doc = await discoverOidc();
    expect(doc.issuer).toBe(`${issuer}/`);
    trailingSlashIssuer = false;
    resetOidcServiceForTesting();
  });

  test("rejects a discovery document over 1 MB", async () => {
    resetOidcServiceForTesting();
    hugeDoc = true;
    await expect(discoverOidc()).rejects.toThrow("OIDC discovery document too large");
    hugeDoc = false;
    resetOidcServiceForTesting();
  });
});

describe("oidcScopes", () => {
  test("defaults to openid email profile with openid first", () => {
    expect(oidcScopes()).toEqual(["openid", "email", "profile"]);
  });

  test("always prepends openid even when the admin omitted it", () => {
    process.env.OIDC_SCOPE = "email";
    resetEnvCache();
    expect(oidcScopes()).toEqual(["openid", "email"]);
    process.env.OIDC_SCOPE = "openid email profile";
    resetEnvCache();
  });
});

describe("authorization URL", () => {
  test("carries response_type, client_id, redirect_uri, state, PKCE and scope", async () => {
    const doc = await discoverOidc();
    const start = buildOidcAuthorizationUrl(doc, "http://localhost/api/v1/auth/oidc/callback");
    const url = new URL(start.url);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost/api/v1/auth/oidc/callback");
    expect(url.searchParams.get("state")).toBe(start.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBe(start.nonce);
    expect(start.codeVerifier).toBeTruthy();
  });
});

describe("token exchange + id_token validation", () => {
  test("happy path exchanges the code and returns parsed user info", async () => {
    const doc = await discoverOidc();
    nextIdToken = await signIdToken({
      email: "alice@example.com",
      email_verified: true,
      name: "Alice Example",
      nonce: "nonce-1",
    });
    const info = await exchangeOidcCode(
      doc,
      "code-1",
      "verifier-1",
      "nonce-1",
      "http://localhost/api/v1/auth/oidc/callback",
    );
    expect(info.subject).toBe("sub-123");
    expect(info.email).toBe("alice@example.com");
    expect(info.name).toBe("Alice Example");
    expect(info.emailVerified).toBe(true);
  });

  test("id_token with wrong nonce is rejected", async () => {
    const idToken = await signIdToken({ email_verified: true });
    await expect(validateIdToken(idToken, "wrong-nonce")).rejects.toThrow();
  });

  test("id_token with wrong issuer is rejected", async () => {
    const idToken = await new SignJWT({ email_verified: true })
      .setProtectedHeader({ alg: "ES256", kid: "test-kid" })
      .setIssuer("https://evil.example.com")
      .setAudience(CLIENT_ID)
      .setSubject("sub-123")
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(validateIdToken(idToken, "nonce-1")).rejects.toThrow();
  });

  test("accepts an id_token whose issuer has a trailing slash", async () => {
    resetOidcServiceForTesting();
    trailingSlashIssuer = true;
    try {
      const idToken = await signIdToken(
        { email: "alice@example.com", email_verified: true, nonce: "nonce-1" },
        `${issuer}/`,
      );
      const info = await validateIdToken(idToken, "nonce-1");
      expect(info.email).toBe("alice@example.com");
    } finally {
      trailingSlashIssuer = false;
      resetOidcServiceForTesting();
    }
  });

  test("id_token with wrong audience is rejected", async () => {
    const idToken = await new SignJWT({ email_verified: true })
      .setProtectedHeader({ alg: "ES256", kid: "test-kid" })
      .setIssuer(issuer)
      .setAudience("some-other-client")
      .setSubject("sub-123")
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(validateIdToken(idToken, "nonce-1")).rejects.toThrow();
  });

  test("missing email in id_token is rejected", async () => {
    const idToken = await signIdToken({
      email_verified: true,
      name: "No Email",
      nonce: "nonce-1",
    });
    await expect(validateIdToken(idToken, "nonce-1")).rejects.toMatchObject({
      code: "email_required",
    });
  });

  test("missing sub in id_token is rejected", async () => {
    const idToken = await new SignJWT({
      email: "a@b.c",
      email_verified: true,
      nonce: "nonce-1",
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-kid" })
      .setIssuer(issuer)
      .setAudience(CLIENT_ID)
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(validateIdToken(idToken, "nonce-1")).rejects.toMatchObject({
      code: "email_required",
    });
  });

  test("email_verified accepts boolean and string-true; unverified false", async () => {
    const boolTrue = await signIdToken({ email: "a@b.c", email_verified: true, nonce: "nonce-1" });
    expect((await validateIdToken(boolTrue, "nonce-1")).emailVerified).toBe(true);
    const strTrue = await signIdToken({ email: "a@b.c", email_verified: "true", nonce: "nonce-1" });
    expect((await validateIdToken(strTrue, "nonce-1")).emailVerified).toBe(true);
    const boolFalse = await signIdToken({
      email: "a@b.c",
      email_verified: false,
      nonce: "nonce-1",
    });
    expect((await validateIdToken(boolFalse, "nonce-1")).emailVerified).toBe(false);
  });
});
