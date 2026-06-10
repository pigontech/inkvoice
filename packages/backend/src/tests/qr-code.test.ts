import { describe, expect, test } from "bun:test";
import { encodeQR, qrToDataUri, qrToSvg } from "../utils/qr-code";

describe("qr-code", () => {
  test("encodes a short URL into a square matrix", () => {
    const { size, modules } = encodeQR("https://example.com/invoice/abc");
    expect(size).toBeGreaterThanOrEqual(21);
    expect(modules.length).toBe(size);
    expect(modules[0].length).toBe(size);
    // Three finder patterns produce dark corners
    expect(modules[0][0]).toBe(true);
    expect(modules[0][size - 1]).toBe(true);
    expect(modules[size - 1][0]).toBe(true);
  });

  test("auto-picks a larger version for longer payloads", () => {
    const small = encodeQR("https://x.io/i/1");
    const large = encodeQR("https://invoices.example.com/public/invoice/" + "a".repeat(80));
    expect(large.size).toBeGreaterThan(small.size);
  });

  test("rejects payloads larger than version 10 capacity", () => {
    const tooLong = "x".repeat(500);
    expect(() => encodeQR(tooLong)).toThrow();
  });

  test("renders SVG with viewBox containing the matrix + border", () => {
    const svg = qrToSvg("hello", { border: 2 });
    expect(svg).toStartWith("<svg");
    expect(svg).toContain('viewBox="0 0 25 25"'); // 21 + 2*2
    expect(svg).toContain("<path");
  });

  test("data URI is base64 svg+xml", () => {
    const uri = qrToDataUri("https://example.com");
    expect(uri).toStartWith("data:image/svg+xml;base64,");
    const b64 = uri.slice("data:image/svg+xml;base64,".length);
    const decoded = Buffer.from(b64, "base64").toString("utf-8");
    expect(decoded).toContain("<svg");
  });

  test("matrix has the timing pattern at row/col 6", () => {
    const { size, modules } = encodeQR("test");
    // Row 6 between finder separators: alternating dark/light starting from col 8.
    // The strip is between (8) and (size-9). At col 8 it should be dark (8 % 2 === 0 maps to true here).
    const start = 8;
    const end = size - 9;
    for (let i = start; i <= end; i++) {
      expect(modules[6][i]).toBe(i % 2 === 0);
    }
  });

  test("always-dark module at (size-8, 8) is set across versions", () => {
    // Spec: every QR has an always-dark module at row 4*version+9, col 8 = (size-8, 8).
    // Cover several versions by varying input length.
    const inputs = ["a", "x".repeat(20), "y".repeat(60), "z".repeat(120)];
    for (const text of inputs) {
      const { size, modules } = encodeQR(text);
      expect(modules[size - 8][8]).toBe(true);
    }
  });

  test("finder pattern shape (7×7 dark square with light interior ring) at top-left", () => {
    const { modules } = encodeQR("hello");
    // Top-left finder: outer 7×7 ring is dark, ring inside is light, 3×3 center is dark.
    // Sample a few key cells:
    expect(modules[0][0]).toBe(true);
    expect(modules[0][6]).toBe(true);
    expect(modules[6][0]).toBe(true);
    expect(modules[6][6]).toBe(true);
    expect(modules[1][1]).toBe(false); // inside light ring
    expect(modules[3][3]).toBe(true); // center
    // Separator (row/col 7) should be light
    expect(modules[7][0]).toBe(false);
    expect(modules[0][7]).toBe(false);
  });
});
