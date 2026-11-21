import crypto from "node:crypto";
import type {
  DeliveryInput,
  DeliveryMessage,
  DeliveryRecipient,
  InvoiceDelivery,
} from "../contracts/banking";
import { getDb } from "../database/connection";
import type { PaginatedResponse } from "../types/common";
import { escapeHtml, escapeMultiline } from "../utils/html";
import { HttpError } from "../utils/http-error";
import { getBankingRecord } from "./banking.service";
import { isEmailConfigured, type MailResult, sendEmail } from "./email.service";
import { finaliseForSending, getInvoice } from "./invoice.service";
import { invoicePdf } from "./invoice-pdf.service";
import { resolvePublicOrigin, sendInvoiceEmail } from "./invoice-send.service";

function messages(requestId: string): DeliveryMessage[] {
  const rows = getDb()
    .query("SELECT * FROM invoice_delivery_messages WHERE request_id = ? ORDER BY rowid")
    .all(requestId) as (Omit<DeliveryMessage, "recipients" | "accepted" | "rejected"> & {
    recipients: string;
    accepted: string;
    rejected: string;
  })[];
  return rows.map((row) => ({
    ...row,
    recipients: JSON.parse(row.recipients),
    accepted: JSON.parse(row.accepted),
    rejected: JSON.parse(row.rejected),
    state:
      row.state === "pending" &&
      Date.now() - Date.parse(`${row.created_at.replace(" ", "T")}Z`) > 600000
        ? "unknown"
        : row.state,
  }));
}
function result(id: string): InvoiceDelivery {
  const request = getDb()
    .query("SELECT id, invoice_id, created_at FROM invoice_delivery_requests WHERE id = ?")
    .get(id) as Omit<InvoiceDelivery, "messages">;
  return { ...request, messages: messages(id) };
}
export function listDeliveries(
  invoiceId: string,
  page: number,
  limit: number,
): PaginatedResponse<InvoiceDelivery> {
  const invoice = getInvoice(invoiceId);
  if (!invoice || invoice.deleted_at)
    throw new HttpError(404, "Invoice not found", undefined, "NOT_FOUND");
  const total = (
    getDb()
      .query("SELECT COUNT(*) AS total FROM invoice_delivery_requests WHERE invoice_id = ?")
      .get(invoiceId) as { total: number }
  ).total;
  const rows = getDb()
    .query(
      "SELECT id FROM invoice_delivery_requests WHERE invoice_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?",
    )
    .all(invoiceId, limit, (page - 1) * limit) as { id: string }[];
  return {
    items: rows.map((row) => result(row.id)),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
export async function deliverInvoice(
  invoiceId: string,
  input: DeliveryInput,
  key: string,
  actorId: string,
  requestOrigin?: string,
): Promise<InvoiceDelivery> {
  const db = getDb();
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ invoiceId, input, actorId }))
    .digest("hex");
  const replay = () => {
    const existing = db
      .query("SELECT id, request_hash FROM invoice_delivery_requests WHERE idempotency_key = ?")
      .get(key) as { id: string; request_hash: string } | null;
    if (!existing) return null;
    if (existing.request_hash !== hash)
      throw new HttpError(
        409,
        "Idempotency key was already used for a different request",
        undefined,
        "CONFLICT",
      );
    const previous = result(existing.id);
    if (previous.messages.some((m) => m.state === "pending"))
      throw new HttpError(
        409,
        "Delivery is still in progress; check sending history before retrying",
        undefined,
        "CONFLICT",
      );
    return previous;
  };
  const previous = replay();
  if (previous) return previous;
  const invoice = getInvoice(invoiceId);
  if (!invoice || invoice.deleted_at)
    throw new HttpError(404, "Invoice not found", undefined, "NOT_FOUND");
  if (invoice.status === "voided" || (input.kind === "private" && invoice.status === "draft"))
    throw new HttpError(
      400,
      "Private copies require an issued, non-voided invoice",
      undefined,
      "VALIDATION_FAILED",
    );
  const origin = resolvePublicOrigin(undefined) || requestOrigin || "";
  let publicOrigin: string;
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    publicOrigin = url.origin;
  } catch {
    throw new HttpError(
      400,
      "Configure the public application URL before sharing an invoice",
      undefined,
      "VALIDATION_FAILED",
    );
  }
  if (!(await isEmailConfigured()))
    throw new HttpError(400, "Email is not configured", undefined, "VALIDATION_FAILED");
  const to = input.kind === "customer" ? input.to || invoice.customer?.email : undefined;
  if (input.kind === "customer" && !to)
    throw new HttpError(400, "No recipient email address", undefined, "VALIDATION_FAILED");
  const recipients: DeliveryRecipient[] = input.recipients.map((r) => {
    const contact = getBankingRecord("contacts", r.contact_id);
    if (contact.archived)
      throw new HttpError(
        400,
        "An archived contact cannot receive new copies",
        undefined,
        "VALIDATION_FAILED",
      );
    if (contact.bank_id && getBankingRecord("banks", contact.bank_id).archived)
      throw new HttpError(
        400,
        "Choose a contact at an active bank",
        undefined,
        "VALIDATION_FAILED",
      );
    return { contact_id: contact.id, name: contact.name, email: contact.email, mode: r.mode };
  });
  const allAddresses = [...(to ? [to] : []), ...recipients.map((r) => r.email)].map((a) =>
    a.toLowerCase(),
  );
  if (new Set(allAddresses).size !== allAddresses.length)
    throw new HttpError(
      400,
      "Each email address may receive only one copy per send",
      undefined,
      "VALIDATION_FAILED",
    );
  const id = crypto.randomUUID();
  try {
    db.transaction(() => {
      db.run(
        "INSERT INTO invoice_delivery_requests (id, invoice_id, idempotency_key, request_hash, actor_id) VALUES (?, ?, ?, ?, ?)",
        [id, invoiceId, key, hash, actorId],
      );
      const insert = (kind: "customer" | "private", target: DeliveryRecipient[]) =>
        db.run(
          "INSERT INTO invoice_delivery_messages (id, request_id, kind, recipients) VALUES (?, ?, ?, ?)",
          [crypto.randomUUID(), id, kind, JSON.stringify(target)],
        );
      if (to)
        insert("customer", [
          { contact_id: null, name: invoice.customer?.name || "Customer", email: to, mode: "to" },
          ...recipients.filter((r) => r.mode === "cc"),
        ]);
      for (const recipient of recipients.filter((r) => r.mode === "private"))
        insert("private", [recipient]);
    })();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      const existing = replay();
      if (existing) return existing;
    }
    throw error;
  }
  let pdf: Buffer | undefined;
  let current: NonNullable<ReturnType<typeof getInvoice>>;
  try {
    current = finaliseForSending(invoiceId)!;
    if (!current.share_token || !current.is_published)
      throw new Error("Invoice cannot be published");
    if (recipients.some((r) => r.mode === "private")) pdf = await invoicePdf(invoiceId);
  } catch (error) {
    db.run(
      "UPDATE invoice_delivery_messages SET state = 'failed', error = ? WHERE request_id = ?",
      [error instanceof Error ? error.message : "Could not prepare invoice", id],
    );
    return result(id);
  }
  const link = `${publicOrigin}/public/invoice/${current.share_token}`;
  for (const message of messages(id)) {
    let outcome: MailResult;
    try {
      if (message.kind === "customer" && input.kind === "customer") {
        outcome = await sendInvoiceEmail(invoiceId, {
          to: to || undefined,
          cc: message.recipients.filter((r) => r.mode === "cc").map((r) => r.email),
          subject: input.subject,
          message: input.message,
          from: input.from,
          replyTo: input.reply_to,
          origin: publicOrigin,
        });
      } else {
        const recipient = message.recipients[0];
        outcome = await sendEmail({
          to: recipient.email,
          subject: input.subject || `Invoice ${current.invoice_number} — copy`,
          text: `Invoice ${current.invoice_number}\n${input.message || ""}\nView invoice: ${link}`,
          html: `<p>Invoice ${escapeHtml(current.invoice_number)}</p><p>${escapeMultiline(input.message || "")}</p><p><a href="${escapeHtml(link)}">View invoice</a></p>`,
          from: input.from,
          replyTo: input.reply_to,
          attachments: [
            {
              filename: `${current.invoice_number.replace(/[^\w.-]/g, "_")}.pdf`,
              content: pdf!,
              contentType: "application/pdf",
            },
          ],
        });
      }
    } catch (error) {
      outcome = {
        success: false,
        error: error instanceof Error ? error.message : "Sending outcome is unknown",
        delivery_state: "unknown",
      };
    }
    const accepted = outcome.success ? outcome.accepted || [] : [];
    const rejected = outcome.success ? outcome.rejected || [] : [];
    // SMTP acceptance is not inbox delivery; timeouts are deliberately never retried automatically.
    const state = outcome.success
      ? accepted.length
        ? "accepted"
        : rejected.length
          ? "failed"
          : "unknown"
      : outcome.delivery_state || "unknown";
    db.run(
      "UPDATE invoice_delivery_messages SET state = ?, accepted = ?, rejected = ?, error = ?, message_id = ? WHERE id = ?",
      [
        state,
        JSON.stringify(accepted),
        JSON.stringify(rejected),
        outcome.success
          ? rejected.length
            ? "Some recipients were rejected"
            : null
          : outcome.error,
        outcome.success ? outcome.message_id || null : null,
        message.id,
      ],
    );
  }
  return result(id);
}
