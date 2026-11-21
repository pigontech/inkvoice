import { z } from "zod";

const text = z.string().trim().max(500);
const optionalText = text.default("");
export const bankInput = z.object({
  name: text.min(1),
  branch: optionalText,
  archived: z.boolean().default(false),
});
export const accountInput = z.object({
  bank_id: z.string().min(1),
  label: text.min(1),
  holder: text.min(1),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default("TND"),
  account_number: optionalText,
  iban: optionalText,
  bic: optionalText,
  instructions: z.string().trim().max(4000).default(""),
  is_default: z.boolean().default(false),
  archived: z.boolean().default(false),
});
export const contactInput = z.object({
  name: text.min(1),
  email: z.string().trim().email().max(254),
  phone: optionalText,
  bank_id: z.string().min(1).nullable().default(null),
  archived: z.boolean().default(false),
});
export type BankInput = z.infer<typeof bankInput>;
export type AccountInput = z.infer<typeof accountInput>;
export type ContactInput = z.infer<typeof contactInput>;
export type Bank = BankInput & { id: string; created_at: string; updated_at: string };
export type BankAccount = AccountInput & {
  id: string;
  bank_name: string;
  created_at: string;
  updated_at: string;
};
export type Contact = ContactInput & {
  id: string;
  bank_name: string | null;
  created_at: string;
  updated_at: string;
};
export interface PaymentDetails {
  bank_id?: string;
  bank_name: string;
  holder: string;
  currency: string;
  account_number: string;
  iban: string;
  bic: string;
  bank_details: string;
}
const emailOptions = {
  subject: z.string().trim().max(500).optional(),
  message: z.string().max(10000).optional(),
  from: z.string().trim().email().optional(),
  reply_to: z.string().trim().email().optional(),
};
const privateRecipient = z.object({ contact_id: z.string().min(1), mode: z.literal("private") });
export const deliveryInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("customer"),
    to: z.string().trim().email().optional(),
    recipients: z
      .array(z.object({ contact_id: z.string().min(1), mode: z.enum(["cc", "private"]) }))
      .max(50)
      .default([]),
    ...emailOptions,
  }),
  z.object({
    kind: z.literal("private"),
    recipients: z.array(privateRecipient).min(1).max(50),
    ...emailOptions,
  }),
]);
export type DeliveryInput = z.infer<typeof deliveryInput>;
export type DeliveryState = "pending" | "accepted" | "failed" | "unknown";
export interface DeliveryRecipient {
  contact_id: string | null;
  name: string;
  email: string;
  mode: "to" | "cc" | "private";
}
export interface DeliveryMessage {
  id: string;
  request_id: string;
  kind: "customer" | "private";
  recipients: DeliveryRecipient[];
  state: DeliveryState;
  accepted: string[];
  rejected: string[];
  error: string | null;
  message_id: string | null;
  created_at: string;
}
export interface InvoiceDelivery {
  id: string;
  invoice_id: string;
  created_at: string;
  messages: DeliveryMessage[];
}
