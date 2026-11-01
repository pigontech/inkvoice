import { describe, expect, test } from "bun:test";
import Mustache from "mustache";
import { readTemplateFile } from "../services/builtin-templates";
import { inlineAddress } from "../utils/html";

const render = (overrides: Record<string, unknown> = {}) =>
  Mustache.render(readTemplateFile("template-din5008.html"), {
    invoice_number: "RE-1",
    company: {
      name: "Muster GmbH",
      address_inline: inlineAddress("Musterstraße 1\n\n10115 Berlin"),
    },
    customer: {
      name: "Beispiel AG",
      city: "München",
      postal_code: "80331",
      phone: "+49 89 1111",
      email: "buchhaltung@beispiel.de",
    },
    items: [
      { description: "A", tax_rate: 19 },
      { description: "B", tax_rate: 0 },
    ],
    ...overrides,
  });

describe("DIN 5008 template", () => {
  test("puts postcode before city on one line", () => {
    expect(render()).toContain("<p>80331 München</p>");
  });

  test("keeps customer phone and email out of the address window", () => {
    const html = render();
    expect(html).not.toContain("+49 89 1111");
    expect(html).not.toContain("buchhaltung@beispiel.de");
  });

  test("titles quotes in German", () => {
    const html = render({ is_quote: true, document_title: "Quote" });
    expect(html).toContain("Angebot");
    expect(html).not.toContain("Quote");
  });

  test("prints the tax rate for zero and missing rates without a stray percent sign", () => {
    expect(render()).toContain(">19%<");
    expect(render()).toContain(">0%<");
    expect(render({ items: [{ description: "A", tax_rate: null }] })).toContain(">0%<");
  });

  test("shows the sender address on one line in the return line and footer", () => {
    const html = render();
    expect(html).toContain("Muster GmbH, Musterstraße 1, 10115 Berlin");
    expect(html).toContain("<span>Musterstraße 1, 10115 Berlin</span>");
  });
});
