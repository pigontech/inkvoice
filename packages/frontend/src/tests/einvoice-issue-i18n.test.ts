import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import de from "../i18n/de";
import en from "../i18n/en";
import es from "../i18n/es";
import fr from "../i18n/fr";
import tr from "../i18n/tr";

// The e-invoice panel words validator issues by their code. A code without a
// message falls back to the API's English text, so every code the backend can
// emit should have one in each language.
const validatorSource = readFileSync(
  join(import.meta.dir, "../../../backend/src/services/einvoice-validator.service.ts"),
  "utf8",
);
const codes = [...validatorSource.matchAll(/\b(?:error|warning)\(\s*"([a-z0-9_]+)"/g)].map(
  (m) => m[1],
);
const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
const english: Record<string, string> = en.einvoice.issue;

describe("e-invoice issue messages", () => {
  test("finds the validator's codes", () => {
    expect(codes.length).toBeGreaterThan(30);
  });

  for (const [lang, dict] of Object.entries({ en, de, tr, es, fr })) {
    const issue: Record<string, string> = dict.einvoice.issue;

    test(`${lang} has a message for every validator code`, () => {
      expect(codes.filter((code) => !issue[code])).toEqual([]);
    });

    test(`${lang} uses the same placeholders as English`, () => {
      for (const [code, text] of Object.entries(issue)) {
        expect({ code, params: placeholders(text) }).toEqual({
          code,
          params: placeholders(english[code]),
        });
      }
    });
  }
});
