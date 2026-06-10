import { Hono } from "hono";
import { z } from "zod";
import * as templateService from "../services/template.service";
import { qrToDataUri } from "../utils/qr-code";

const templates = new Hono();

templates.get("/", (c) => {
  const data = templateService.listTemplates();
  return c.json({ success: true, data });
});

templates.get("/:id", (c) => {
  const template = templateService.getTemplate(c.req.param("id"));
  if (!template) {
    return c.json({ success: false, error: "Template not found" }, 404);
  }
  return c.json({ success: true, data: template });
});

const templateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().or(z.literal("")),
  html_content: z.string().min(1),
  css_content: z.string().optional().or(z.literal("")),
  is_default: z.number().min(0).max(1).optional(),
});

templates.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = templateSchema.parse(body);
  const template = templateService.createTemplate(parsed);
  return c.json({ success: true, data: template }, 201);
});

templates.put("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = templateSchema.parse(body);
  const template = templateService.updateTemplate(c.req.param("id"), parsed);
  if (!template) {
    return c.json({ success: false, error: "Template not found" }, 404);
  }
  return c.json({ success: true, data: template });
});

templates.delete("/:id", (c) => {
  const result = templateService.deleteTemplate(c.req.param("id"));
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }
  return c.json({ success: true });
});

templates.put("/:id/default", (c) => {
  const template = templateService.setDefault(c.req.param("id"));
  if (!template) {
    return c.json({ success: false, error: "Template not found" }, 404);
  }
  return c.json({ success: true, data: template });
});

// Return the bundled HTML/CSS for a builtin template (used by "Reset to default")
templates.get("/:id/bundled", (c) => {
  const bundled = templateService.getBundledTemplate(c.req.param("id"));
  if (!bundled) {
    return c.json(
      { success: false, error: "Bundled content is only available for builtin templates" },
      404,
    );
  }
  return c.json({ success: true, data: bundled });
});

// Install template from remote manifest URL
templates.post("/install-url", async (c) => {
  const body = await c.req.json();
  const { url, expected_hash } = z
    .object({
      url: z.string().url(),
      expected_hash: z.string().optional(),
    })
    .parse(body);
  try {
    const template = await templateService.installFromUrl(url, expected_hash);
    return c.json({ success: true, data: template }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// Upload template (multipart-style JSON)
templates.post("/install-upload", async (c) => {
  const body = await c.req.json();
  const { name, description, html_content, css_content } = z
    .object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional().nullable(),
      html_content: z.string().min(1),
      css_content: z.string().optional().nullable(),
    })
    .parse(body);
  try {
    const template = await templateService.installFromUpload(
      name,
      description || null,
      html_content,
      css_content || null,
    );
    return c.json({ success: true, data: template }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// Update remote template from its manifest URL
templates.post("/:id/update-remote", async (c) => {
  try {
    const result = await templateService.updateFromManifest(c.req.param("id"));
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

templates.post("/preview", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const htmlContent = body.html_content || "";
  const cssContent = body.css_content || "";
  const context = getSampleContext();
  const html = templateService.renderTemplate(htmlContent, context);
  const fullHtml = cssContent ? `<style>${cssContent}</style>${html}` : html;
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;",
  );
  return c.html(fullHtml);
});

templates.post("/:id/preview", async (c) => {
  const template = templateService.getTemplate(c.req.param("id"));
  if (!template) {
    return c.json({ success: false, error: "Template not found" }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const context = body.context || getSampleContext();
  const htmlContent = body.html_content ?? template.html_content;
  const cssContent = body.css_content ?? (template.css_content || "");
  const html = templateService.renderTemplate(htmlContent, context);
  const fullHtml = cssContent ? `<style>${cssContent}</style>${html}` : html;
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;",
  );
  return c.html(fullHtml);
});

function getSampleContext() {
  return {
    invoice_number: "INV-2026-0001",
    issue_date: "Apr 1, 2026",
    due_date: "May 1, 2026",
    company: {
      name: "My Company",
      logo: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxODAgNjgiIHdpZHRoPSIxODAiIGhlaWdodD0iNjgiPgogIDxkZWZzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJpdmYtcyIgeDE9IjAlIiB5MT0iMCUiIHgyPSIxMDAlIiB5Mj0iMCUiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjMGYxNzJhIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iIzMzNDE1NSIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iaXZmLWEiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjZjk3MzE2Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iI2VmNDQ0NCIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICA8L2RlZnM+CiAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoNiwgNikiPgogICAgPHBhdGggZD0iTTE0IDE2IEMxNCAxNiwgMTggMjAsIDE2IDMyIEMxNCA0NCwgMTAgNTYsIDEyIDYwIiBzdHJva2U9InVybCgjaXZmLXMpIiBzdHJva2Utd2lkdGg9IjYiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgZmlsbD0ibm9uZSIvPgogICAgPGNpcmNsZSBjeD0iMTYiIGN5PSI4IiByPSI1IiBmaWxsPSJ1cmwoI2l2Zi1hKSIvPgogICAgPGNpcmNsZSBjeD0iMjIiIGN5PSI2IiByPSIyIiBmaWxsPSIjZjk3MzE2IiBvcGFjaXR5PSIwLjQiLz4KICAgIDxjaXJjbGUgY3g9IjEyIiBjeT0iNCIgcj0iMS41IiBmaWxsPSIjZWY0NDQ0IiBvcGFjaXR5PSIwLjMiLz4KICAgIDxwYXRoIGQ9Ik0yNCAxNiBDMjQgMTYsIDMwIDQwLCAzNCA1MiBDMzggNDAsIDQ0IDE2LCA0NCAxNiIgc3Ryb2tlPSJ1cmwoI2l2Zi1zKSIgc3Ryb2tlLXdpZHRoPSI1IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGZpbGw9Im5vbmUiLz4KICAgIDxwYXRoIGQ9Ik0xMiA2MCBDMTYgNjIsIDIwIDYwLCAyMiA1NiIgc3Ryb2tlPSJ1cmwoI2l2Zi1hKSIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjAuNSIvPgogIDwvZz4KICA8dGV4dCB4PSI2MiIgeT0iNTAiIGZvbnQtZmFtaWx5PSJzeXN0ZW0tdWksIC1hcHBsZS1zeXN0ZW0sIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMzQiIGxldHRlci1zcGFjaW5nPSItMS41IiBmaWxsPSJ1cmwoI2l2Zi1zKSI+CiAgICA8dHNwYW4gZm9udC13ZWlnaHQ9IjkwMCI+aW5rPC90c3Bhbj4KICAgIDx0c3BhbiBmb250LXdlaWdodD0iNDAwIiBmaWxsPSIjNDc1NTY5Ij52b2ljZTwvdHNwYW4+CiAgPC90ZXh0PgogIDxwYXRoIGQ9Ik02MiA1NiBDODAgNTgsIDEyMCA1NCwgMTYwIDU2IiBzdHJva2U9InVybCgjaXZmLWEpIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgZmlsbD0ibm9uZSIvPgo8L3N2Zz4K",
      email: "hello@mycompany.com",
      phone: "+1 555-0123",
      address: "123 Main St, City, ST 12345",
      tax_id: "CHE-123.456.789 MWST",
      bank_details: "IBAN: CH00 0000 0000 0000 0000 0<br>Bank: Example Bank AG",
    },
    customer: {
      name: "John Doe",
      email: "john@example.com",
      address_line1: "456 Oak Ave",
      city: "Springfield",
      state: "IL",
      postal_code: "62701",
      country: "US",
      country_name: "United States",
    },
    items: [
      {
        description: "Web Design",
        quantity: 1,
        unit: "piece",
        formatted_unit_price: "$1,500.00",
        tax_rate: 10,
        formatted_line_total: "$1,500.00",
      },
      {
        description: "Hosting (12 months)",
        quantity: 12,
        unit: "month",
        formatted_unit_price: "$25.00",
        tax_rate: 10,
        formatted_line_total: "$300.00",
      },
    ],
    formatted_subtotal: "$1,800.00",
    has_discount: false,
    formatted_discount: "$0.00",
    tax_summary: [{ name: "VAT", rate: 10, formatted_amount: "$180.00" }],
    formatted_total: "$1,980.00",
    payment_terms: "Net 30",
    notes: "Thank you for your business!",
    qr: {
      url: "https://invoices.example.com/public/invoice/sample",
      image: qrToDataUri("https://invoices.example.com/public/invoice/sample"),
    },
  };
}

export { templates };
