import type { XmlProfile } from "../base-profile";
import type { XmlInvoiceData } from "../types";

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function amt(n: number): string {
  return n.toFixed(2);
}

export class FatturaPaProfile implements XmlProfile {
  getProfileId(): string {
    return "fatturapa";
  }
  getProfileName(): string {
    return "FatturaPA (Italian e-invoicing)";
  }
  getMimeType(): string {
    return "application/xml";
  }

  generateXml(data: XmlInvoiceData): string {
    const isCredit = data.type === "credit_note";
    const tipoDoc = isCredit ? "TD04" : "TD01";

    const lines: string[] = [];
    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    lines.push(
      `<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    );

    // Header
    lines.push(`  <FatturaElettronicaHeader>`);

    // DatiTrasmissione
    lines.push(`    <DatiTrasmissione>`);
    lines.push(`      <IdTrasmittente>`);
    lines.push(`        <IdPaese>${esc(data.supplier.country || "IT")}</IdPaese>`);
    lines.push(`        <IdCodice>${esc(data.supplier.tax_id || "00000000000")}</IdCodice>`);
    lines.push(`      </IdTrasmittente>`);
    lines.push(`      <ProgressivoInvio>${esc(data.invoice_number)}</ProgressivoInvio>`);
    lines.push(`      <FormatoTrasmissione>FPR12</FormatoTrasmissione>`);
    lines.push(`      <CodiceDestinatario>0000000</CodiceDestinatario>`);
    lines.push(`    </DatiTrasmissione>`);

    // CedentePrestatore (Supplier)
    lines.push(`    <CedentePrestatore>`);
    lines.push(`      <DatiAnagrafici>`);
    lines.push(`        <IdFiscaleIVA>`);
    lines.push(`          <IdPaese>${esc(data.supplier.country || "IT")}</IdPaese>`);
    lines.push(`          <IdCodice>${esc(data.supplier.tax_id || "")}</IdCodice>`);
    lines.push(`        </IdFiscaleIVA>`);
    lines.push(
      `        <Anagrafica><Denominazione>${esc(data.supplier.name)}</Denominazione></Anagrafica>`,
    );
    lines.push(`        <RegimeFiscale>RF01</RegimeFiscale>`);
    lines.push(`      </DatiAnagrafici>`);
    lines.push(`      <Sede>`);
    lines.push(`        <Indirizzo>${esc(data.supplier.address || "N/A")}</Indirizzo>`);
    lines.push(`        <CAP>00000</CAP>`);
    lines.push(`        <Comune>N/A</Comune>`);
    lines.push(`        <Nazione>${esc(data.supplier.country || "IT")}</Nazione>`);
    lines.push(`      </Sede>`);
    lines.push(`    </CedentePrestatore>`);

    // CessionarioCommittente (Customer)
    lines.push(`    <CessionarioCommittente>`);
    lines.push(`      <DatiAnagrafici>`);
    if (data.customer.tax_id) {
      lines.push(`        <IdFiscaleIVA>`);
      lines.push(`          <IdPaese>${esc(data.customer.country || "IT")}</IdPaese>`);
      lines.push(`          <IdCodice>${esc(data.customer.tax_id)}</IdCodice>`);
      lines.push(`        </IdFiscaleIVA>`);
    }
    lines.push(
      `        <Anagrafica><Denominazione>${esc(data.customer.name)}</Denominazione></Anagrafica>`,
    );
    lines.push(`      </DatiAnagrafici>`);
    lines.push(`      <Sede>`);
    lines.push(`        <Indirizzo>${esc(data.customer.address_line1 || "N/A")}</Indirizzo>`);
    lines.push(`        <CAP>${esc(data.customer.postal_code || "00000")}</CAP>`);
    lines.push(`        <Comune>${esc(data.customer.city || "N/A")}</Comune>`);
    lines.push(`        <Nazione>${esc(data.customer.country || "IT")}</Nazione>`);
    lines.push(`      </Sede>`);
    lines.push(`    </CessionarioCommittente>`);
    lines.push(`  </FatturaElettronicaHeader>`);

    // Body
    lines.push(`  <FatturaElettronicaBody>`);

    // DatiGenerali
    lines.push(`    <DatiGenerali>`);
    lines.push(`      <DatiGeneraliDocumento>`);
    lines.push(`        <TipoDocumento>${tipoDoc}</TipoDocumento>`);
    lines.push(`        <Divisa>${esc(data.currency)}</Divisa>`);
    lines.push(`        <Data>${data.issue_date}</Data>`);
    lines.push(`        <Numero>${esc(data.invoice_number)}</Numero>`);
    if (data.discount_amount > 0) {
      lines.push(`        <ScontoMaggiorazione>`);
      lines.push(`          <Tipo>SC</Tipo>`);
      lines.push(`          <Importo>${amt(data.discount_amount)}</Importo>`);
      lines.push(`        </ScontoMaggiorazione>`);
    }
    lines.push(`        <ImportoTotaleDocumento>${amt(data.total)}</ImportoTotaleDocumento>`);
    lines.push(`      </DatiGeneraliDocumento>`);
    lines.push(`    </DatiGenerali>`);

    // DatiBeniServizi
    lines.push(`    <DatiBeniServizi>`);
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      lines.push(`      <DettaglioLinee>`);
      lines.push(`        <NumeroLinea>${i + 1}</NumeroLinea>`);
      lines.push(`        <Descrizione>${esc(item.description)}</Descrizione>`);
      lines.push(`        <Quantita>${item.quantity.toFixed(2)}</Quantita>`);
      lines.push(`        <PrezzoUnitario>${amt(item.unit_price)}</PrezzoUnitario>`);
      lines.push(`        <PrezzoTotale>${amt(item.line_total)}</PrezzoTotale>`);
      lines.push(`        <AliquotaIVA>${amt(item.tax_rate)}</AliquotaIVA>`);
      lines.push(`      </DettaglioLinee>`);
    }

    // DatiRiepilogo (Tax summary)
    for (const tax of data.tax_breakdown) {
      lines.push(`      <DatiRiepilogo>`);
      lines.push(`        <AliquotaIVA>${amt(tax.tax_rate)}</AliquotaIVA>`);
      lines.push(`        <ImponibileImporto>${amt(tax.taxable_amount)}</ImponibileImporto>`);
      lines.push(`        <Imposta>${amt(tax.tax_amount)}</Imposta>`);
      lines.push(`        <EsigibilitaIVA>I</EsigibilitaIVA>`);
      lines.push(`      </DatiRiepilogo>`);
    }
    lines.push(`    </DatiBeniServizi>`);

    // DatiPagamento
    if (data.payment_terms || data.due_date) {
      lines.push(`    <DatiPagamento>`);
      lines.push(`      <CondizioniPagamento>TP02</CondizioniPagamento>`);
      lines.push(`      <DettaglioPagamento>`);
      lines.push(`        <ModalitaPagamento>MP05</ModalitaPagamento>`);
      if (data.due_date) {
        lines.push(`        <DataScadenzaPagamento>${data.due_date}</DataScadenzaPagamento>`);
      }
      lines.push(`        <ImportoPagamento>${amt(data.total)}</ImportoPagamento>`);
      lines.push(`      </DettaglioPagamento>`);
      lines.push(`    </DatiPagamento>`);
    }

    lines.push(`  </FatturaElettronicaBody>`);
    lines.push(`</p:FatturaElettronica>`);

    return lines.join("\n");
  }
}
