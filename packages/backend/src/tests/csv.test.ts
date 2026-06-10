import { describe, expect, test } from "bun:test";
import { buildCsv, type CsvColumn, csvHeaders } from "../utils/csv";

describe("buildCsv", () => {
  const columns: CsvColumn<{ name: string; value: number }>[] = [
    { header: "Name", key: "name" },
    { header: "Value", key: "value" },
  ];

  test("basic rows", () => {
    const result = buildCsv([{ name: "Alice", value: 10 }], columns);
    expect(result).toBe("Name,Value\r\nAlice,10");
  });

  test("empty rows produces header only", () => {
    const result = buildCsv([], columns);
    expect(result).toBe("Name,Value");
  });

  test("escapes commas in values", () => {
    const result = buildCsv([{ name: "A, B", value: 1 }], columns);
    expect(result).toBe('Name,Value\r\n"A, B",1');
  });

  test("escapes double quotes", () => {
    const result = buildCsv([{ name: 'She said "hi"', value: 1 }], columns);
    expect(result).toBe('Name,Value\r\n"She said ""hi""",1');
  });

  test("escapes newlines", () => {
    const result = buildCsv([{ name: "line1\nline2", value: 1 }], columns);
    expect(result).toBe('Name,Value\r\n"line1\nline2",1');
  });

  test("handles null and undefined", () => {
    type Row = { name: string | null; value: number | undefined };
    const cols: CsvColumn<Row>[] = [
      { header: "Name", key: "name" },
      { header: "Value", key: "value" },
    ];
    const result = buildCsv([{ name: null, value: undefined } as Row], cols);
    expect(result).toBe("Name,Value\r\n,");
  });

  test("uses formatter when provided", () => {
    type Row = { name: string; active: number };
    const cols: CsvColumn<Row>[] = [
      { header: "Name", key: "name" },
      { header: "Active", key: "active", formatter: (v) => (v === 1 ? "Yes" : "No") },
    ];
    const result = buildCsv(
      [
        { name: "A", active: 1 },
        { name: "B", active: 0 },
      ],
      cols,
    );
    expect(result).toBe("Name,Active\r\nA,Yes\r\nB,No");
  });

  test("handles unicode characters", () => {
    const result = buildCsv([{ name: "Müller GmbH", value: 42 }], columns);
    expect(result).toBe("Name,Value\r\nMüller GmbH,42");
  });

  test("multiple rows", () => {
    const result = buildCsv(
      [
        { name: "Alice", value: 10 },
        { name: "Bob", value: 20 },
      ],
      columns,
    );
    expect(result).toBe("Name,Value\r\nAlice,10\r\nBob,20");
  });
});

describe("csvHeaders", () => {
  test("returns correct content type and disposition", () => {
    const headers = csvHeaders("test.csv");
    expect(headers["Content-Type"]).toBe("text/csv; charset=utf-8");
    expect(headers["Content-Disposition"]).toBe('attachment; filename="test.csv"');
  });

  test("escapes quotes in filename", () => {
    const headers = csvHeaders('file"name.csv');
    expect(headers["Content-Disposition"]).toBe('attachment; filename="file\\"name.csv"');
  });
});
