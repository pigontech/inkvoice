import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface BuiltinTemplate {
  slug: string;
  name: string;
  description: string;
  file: string;
  isDefault: boolean;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    slug: "inkvoice",
    name: "Inkvoice",
    description: "Clean, structured invoice with bordered address blocks and expandable line items",
    file: "template-inkvoice.html",
    isDefault: true,
  },
  {
    slug: "editorial",
    name: "Editorial",
    description: "Elegant serif typography with gold accents and decorative borders",
    file: "template-editorial.html",
    isDefault: false,
  },
  {
    slug: "swiss",
    name: "Swiss",
    description: "Minimalist monospace design with bold number hero and red accents",
    file: "template-swiss.html",
    isDefault: false,
  },
  {
    slug: "minimal",
    name: "Minimal",
    description:
      "Stripped-back single-column layout with generous whitespace and a quiet, modern tone",
    file: "template-minimal.html",
    isDefault: false,
  },
];

export function readTemplateFile(filename: string): string {
  // templates/ is at project root, backend runs from packages/backend
  const paths = [
    join(process.cwd(), "templates", filename),
    join(process.cwd(), "..", "..", "templates", filename),
    join(import.meta.dir, "..", "..", "..", "..", "templates", filename),
  ];
  for (const p of paths) {
    try {
      return readFileSync(p, "utf-8");
    } catch {
      // try next path
    }
  }
  throw new Error(`Could not find template file: ${filename}`);
}

export function getBuiltinTemplateByName(name: string): BuiltinTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.name === name);
}
