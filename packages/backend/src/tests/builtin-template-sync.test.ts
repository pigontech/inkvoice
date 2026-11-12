// Regression: every boot overwrote each built-in template whose HTML differed
// from the bundled file, so an edit saved in the template editor was gone
// after the next restart. A built-in now moves to the bundled HTML only while
// its HTML is a version some release bundled.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import {
  BUILTIN_TEMPLATES,
  hashTemplateHtml,
  readTemplateFile,
} from "../services/builtin-templates";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-builtin-template-sync.db";

// templates/template-minimal.html exactly as v0.1.0 bundled it.
const MINIMAL_V010 = readFileSync(
  join(import.meta.dir, "fixtures", "template-minimal-v0.1.0.mustache"),
  "utf-8",
);

let app: Hono;
let token: string;

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  html_content: string;
  css_content: string | null;
  is_default: number;
  updated_at: string;
}

function builtin(name: string): TemplateRow {
  const row = getDb()
    .query("SELECT * FROM templates WHERE type = 'builtin' AND name = ?")
    .get(name) as TemplateRow | null;
  if (!row) throw new Error(`No built-in template named ${name}`);
  return row;
}

function bundled(name: string): string {
  const tmpl = BUILTIN_TEMPLATES.find((t) => t.name === name);
  if (!tmpl) throw new Error(`No bundled template named ${name}`);
  return readTemplateFile(tmpl.file);
}

/** Puts a built-in's HTML in place directly, as an earlier boot would have. */
function setHtml(name: string, html: string): void {
  getDb().run("UPDATE templates SET html_content = ? WHERE type = 'builtin' AND name = ?", [
    html,
    name,
  ]);
}

async function authed(path: string, opts: RequestInit = {}): Promise<Response> {
  return app.request(`http://localhost${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
}

/** Saves `html` the way the template editor's Save button does. */
async function save(row: TemplateRow, html: string): Promise<void> {
  const res = await authed(`/api/v1/templates/${row.id}`, {
    method: "PUT",
    body: JSON.stringify({
      id: row.id,
      name: row.name,
      description: row.description || "",
      html_content: html,
      css_content: row.css_content || "",
    }),
  });
  expect(res.status).toBe(200);
}

/** A restart on the same database. */
const boot = () => seed();

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "testpass123456";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "false";
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();
  app = createApp();

  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "testpass123456" }),
  });
  token = ((await res.json()) as { data: { token: string } }).data.token;
});

beforeEach(async () => {
  // Every test starts from the built-ins a new install gets.
  getDb().run("DELETE FROM templates");
  getDb().run("DELETE FROM builtin_template_versions");
  await seed();
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

describe("built-in template sync at boot", () => {
  test("adds a built-in the database does not have yet", async () => {
    // An install from before DIN 5008 shipped.
    getDb().run("DELETE FROM templates WHERE name = 'DIN 5008'");
    await boot();

    const din = builtin("DIN 5008");
    expect(din.html_content).toBe(bundled("DIN 5008"));
    expect(din.is_default).toBe(0);
    expect(builtin("Inkvoice").is_default).toBe(1);
  });

  test("keeps a built-in the user edited", async () => {
    const edited = bundled("Swiss").replace("</body>", "<p>Our bank details</p></body>");
    expect(edited).not.toBe(bundled("Swiss"));
    await save(builtin("Swiss"), edited);
    const before = builtin("Swiss");

    getDb().run("DELETE FROM builtin_template_versions");
    await boot();

    const after = builtin("Swiss");
    expect(after.html_content).toBe(edited);
    expect(after.updated_at).toBe(before.updated_at);
    // The boot still records the HTML it bundles: resetting this template
    // saves that HTML, and the next release must take it as unedited.
    const recorded = getDb()
      .query("SELECT 1 FROM builtin_template_versions WHERE name = 'Swiss' AND sha256 = ?")
      .get(hashTemplateHtml(bundled("Swiss")));
    expect(recorded).not.toBeNull();
  });

  test("keeps a built-in holding the HTML of a different built-in", async () => {
    setHtml("Editorial", bundled("Swiss"));
    await boot();

    expect(builtin("Editorial").html_content).toBe(bundled("Swiss"));
  });

  test("updates an untouched built-in that an older release bundled", async () => {
    // As v0.1.0 left it: that release kept Minimal on this HTML and had no
    // versions table, so only the frozen history knows it.
    setHtml("Minimal", MINIMAL_V010);
    getDb().run("DELETE FROM builtin_template_versions");
    await boot();

    expect(builtin("Minimal").html_content).toBe(bundled("Minimal"));
  });

  test("updates an untouched built-in on a version an earlier boot recorded", async () => {
    // HTML a release after the frozen history bundled, recorded by its boot.
    const later = "<html><body>Editorial as a later release bundled it</body></html>";
    getDb().run("INSERT INTO builtin_template_versions (name, sha256) VALUES ('Editorial', ?)", [
      hashTemplateHtml(later),
    ]);
    setHtml("Editorial", later);
    await boot();

    expect(builtin("Editorial").html_content).toBe(bundled("Editorial"));
  });

  test("Reset to default saves exactly the bundled HTML", async () => {
    await save(builtin("Swiss"), "<p>Our own layout</p>");

    // Reset to default loads this into the editor, then Save sends it back.
    const res = await authed(`/api/v1/templates/${builtin("Swiss").id}/bundled`);
    const reset = ((await res.json()) as { data: { html_content: string } }).data.html_content;
    await save(builtin("Swiss"), reset);

    expect(builtin("Swiss").html_content).toBe(bundled("Swiss"));
  });

  test("updates a built-in reset to default at an older release", async () => {
    // At v0.1.0 the user edited Minimal and its description, then reset the
    // HTML and saved, which saved the HTML v0.1.0 bundled.
    await save(builtin("Minimal"), "<p>Our own layout</p>");
    await save({ ...builtin("Minimal"), description: "Our quiet layout" }, MINIMAL_V010);
    getDb().run("DELETE FROM builtin_template_versions");
    await boot();

    expect(builtin("Minimal").html_content).toBe(bundled("Minimal"));
    expect(builtin("Minimal").description).toBe("Our quiet layout");
  });
});
