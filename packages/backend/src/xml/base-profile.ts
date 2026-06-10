import type { XmlInvoiceData } from "./types";

export interface XmlProfile {
  getProfileId(): string;
  getProfileName(): string;
  getMimeType(): string;
  generateXml(data: XmlInvoiceData): string;
}
