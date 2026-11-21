import crypto from "node:crypto";
import Mustache from "mustache";
import { getDb } from "../database/connection";
import type { Template } from "../types/settings";
import { sanitizeHtml } from "../utils/html-sanitizer";
import { logger } from "../utils/logger";
import {
  publicFetchError,
  SafeFetchError,
  type SafeFetchOptions,
  safeFetchJson,
  safeFetchText,
} from "../utils/safe-fetch";
import { getBuiltinTemplateByName, readTemplateFile } from "./builtin-templates";

const MAX_TEMPLATE_SIZE = 128 * 1024; // 128KB

// The manifest URL comes from whoever installs the template and the file URLs
// from the manifest, so every remote read goes through safe-fetch: each hop
// SSRF-checked, the body capped (generously, as MAX_TEMPLATE_SIZE counts
// characters and a UTF-8 character can take 4 bytes), a timeout set.
const REMOTE_FETCH: SafeFetchOptions = { timeoutMs: 10_000, maxBytes: 1024 * 1024 };

/** Rethrows a remote read failure carrying only the coarse reason (see
 *  safe-fetch.ts); the detail goes to the log. */
function remoteFailure(file: string) {
  return (err: unknown): never => {
    logger.warn({ err, file }, "Remote template fetch failed");
    throw new Error(`Failed to fetch ${file}: ${publicFetchError(err)}`);
  };
}

/** A stylesheet that answers non-2xx is skipped rather than failing the install. */
function skipMissingStylesheet(err: unknown): null {
  if (err instanceof SafeFetchError && err.code === "http_error") return null;
  return remoteFailure("stylesheet")(err);
}

export function listTemplates(): Template[] {
  const db = getDb();
  return db.query("SELECT * FROM templates ORDER BY type, name").all() as Template[];
}

export function getTemplate(id: string): Template | null {
  const db = getDb();
  return db.query("SELECT * FROM templates WHERE id = ?").get(id) as Template | null;
}

export function getDefaultTemplate(): Template | null {
  const db = getDb();
  return db.query("SELECT * FROM templates WHERE is_default = 1 LIMIT 1").get() as Template | null;
}

export function createTemplate(data: Partial<Template>): Template {
  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");

  db.run(
    "INSERT INTO templates (id, name, description, html_content, css_content, type, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      data.name!,
      data.description || null,
      data.html_content!,
      data.css_content || null,
      data.type || "custom",
      data.is_default ?? 0,
    ],
  );

  return db.query("SELECT * FROM templates WHERE id = ?").get(id) as Template;
}

export function updateTemplate(id: string, data: Partial<Template>): Template | null {
  const db = getDb();
  const existing = db.query("SELECT id, is_default FROM templates WHERE id = ?").get(id) as {
    id: string;
    is_default: number;
  } | null;
  if (!existing) return null;

  // Preserve is_default if not explicitly provided
  const isDefault = data.is_default !== undefined ? data.is_default : existing.is_default;

  db.run(
    `UPDATE templates SET name = ?, description = ?, html_content = ?, css_content = ?,
     is_default = ?, updated_at = datetime('now') WHERE id = ?`,
    [
      data.name!,
      data.description || null,
      data.html_content!,
      data.css_content || null,
      isDefault,
      id,
    ],
  );

  return db.query("SELECT * FROM templates WHERE id = ?").get(id) as Template;
}

export function deleteTemplate(id: string): { success: boolean; error?: string } {
  const db = getDb();
  const template = db.query("SELECT type, is_default FROM templates WHERE id = ?").get(id) as {
    type: string;
    is_default: number;
  } | null;
  if (!template) return { success: false, error: "Template not found" };
  if (template.type === "builtin")
    return { success: false, error: "Cannot delete built-in templates" };
  if (template.is_default)
    return {
      success: false,
      error: "Cannot delete the default template. Set another template as default first.",
    };

  const count = db.query("SELECT COUNT(*) as count FROM templates").get() as { count: number };
  if (count.count <= 1) return { success: false, error: "Cannot delete the last template" };

  db.run("DELETE FROM templates WHERE id = ?", [id]);
  return { success: true };
}

export function setDefault(id: string): Template | null {
  const db = getDb();
  // Clearing the flag for an unknown id would leave no default template, and
  // invoices without a template of their own would stop rendering.
  if (!getTemplate(id)) return null;
  db.transaction(() => {
    db.run("UPDATE templates SET is_default = 0");
    db.run("UPDATE templates SET is_default = 1 WHERE id = ?", [id]);
  })();
  return getTemplate(id);
}

export function renderTemplate(htmlContent: string, context: Record<string, unknown>): string {
  return Mustache.render(htmlContent, context);
}

/**
 * For builtin templates, return the bundled HTML/CSS shipped with the app.
 * Used by the "Reset to default" button in the template editor.
 * Returns null for non-builtin templates or unknown bundle names.
 */
export function getBundledTemplate(
  id: string,
): { html_content: string; css_content: string } | null {
  const template = getTemplate(id);
  if (!template || template.type !== "builtin") return null;
  const builtin = getBuiltinTemplateByName(template.name);
  if (!builtin) return null;
  try {
    return { html_content: readTemplateFile(builtin.file), css_content: "" };
  } catch {
    return null;
  }
}

export async function installFromUrl(url: string, expectedHash?: string): Promise<Template> {
  const manifest = (await safeFetchJson(url, REMOTE_FETCH).catch(remoteFailure("manifest"))) as {
    name?: string;
    description?: string;
    html_url?: string;
    css_url?: string;
    sha256?: string;
  };

  if (!manifest.name || !manifest.html_url) {
    throw new Error("Invalid manifest: name and html_url are required");
  }

  let htmlContent = await safeFetchText(manifest.html_url, REMOTE_FETCH).catch(
    remoteFailure("template HTML"),
  );

  if (htmlContent.length > MAX_TEMPLATE_SIZE) {
    throw new Error(`Template exceeds maximum size of ${MAX_TEMPLATE_SIZE / 1024}KB`);
  }

  const hash = new Bun.CryptoHasher("sha256").update(htmlContent).digest("hex");
  const checkHash = expectedHash || manifest.sha256;
  if (checkHash && hash !== checkHash) {
    throw new Error("Hash verification failed");
  }

  htmlContent = sanitizeHtml(htmlContent);

  let cssContent: string | null = null;
  if (manifest.css_url) {
    cssContent = await safeFetchText(manifest.css_url, REMOTE_FETCH).catch(skipMissingStylesheet);
  }

  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");
  db.run(
    `INSERT INTO templates (id, name, description, html_content, css_content, type, source_url, manifest_url, sha256_hash, file_size, installed_at)
     VALUES (?, ?, ?, ?, ?, 'remote', ?, ?, ?, ?, datetime('now'))`,
    [
      id,
      manifest.name,
      manifest.description || null,
      htmlContent,
      cssContent,
      manifest.html_url,
      url,
      hash,
      htmlContent.length,
    ],
  );
  return db.query("SELECT * FROM templates WHERE id = ?").get(id) as Template;
}

export async function installFromUpload(
  name: string,
  description: string | null,
  htmlContent: string,
  cssContent: string | null,
): Promise<Template> {
  if (htmlContent.length > MAX_TEMPLATE_SIZE) {
    throw new Error(`Template exceeds maximum size of ${MAX_TEMPLATE_SIZE / 1024}KB`);
  }
  const sanitized = sanitizeHtml(htmlContent);
  const hash = new Bun.CryptoHasher("sha256").update(sanitized).digest("hex");

  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");
  db.run(
    `INSERT INTO templates (id, name, description, html_content, css_content, type, sha256_hash, file_size, installed_at)
     VALUES (?, ?, ?, ?, ?, 'local', ?, ?, datetime('now'))`,
    [id, name, description, sanitized, cssContent, hash, sanitized.length],
  );
  return db.query("SELECT * FROM templates WHERE id = ?").get(id) as Template;
}

export async function updateFromManifest(
  id: string,
): Promise<{ updated: boolean; template?: Template }> {
  const db = getDb();
  const template = db.query("SELECT * FROM templates WHERE id = ?").get(id) as Template | null;
  if (!template) throw new Error("Template not found");
  if (template.type !== "remote")
    throw new Error("Only remote templates can be updated from manifest");

  const manifestUrl = template.manifest_url;
  if (!manifestUrl) throw new Error("No manifest URL stored for this template");

  const manifest = (await safeFetchJson(manifestUrl, REMOTE_FETCH).catch(
    remoteFailure("manifest"),
  )) as {
    html_url?: string;
    css_url?: string;
    sha256?: string;
  };

  if (!manifest.html_url) throw new Error("Invalid manifest");
  let htmlContent = await safeFetchText(manifest.html_url, REMOTE_FETCH).catch(
    remoteFailure("template"),
  );

  const newHash = new Bun.CryptoHasher("sha256").update(htmlContent).digest("hex");
  if (newHash === template.sha256_hash) {
    return { updated: false };
  }

  htmlContent = sanitizeHtml(htmlContent);

  let cssContent: string | null = null;
  if (manifest.css_url) {
    cssContent = await safeFetchText(manifest.css_url, REMOTE_FETCH).catch(skipMissingStylesheet);
  }

  db.run(
    `UPDATE templates SET html_content = ?, css_content = ?, sha256_hash = ?, file_size = ?, updated_at = datetime('now') WHERE id = ?`,
    [htmlContent, cssContent, newHash, htmlContent.length, id],
  );
  const updated = db.query("SELECT * FROM templates WHERE id = ?").get(id) as Template;
  return { updated: true, template: updated };
}
