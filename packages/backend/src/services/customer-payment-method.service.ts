import crypto from "node:crypto";
import { getDb } from "../database/connection";
import { logger } from "../utils/logger";
import { getStripe } from "./stripe.service";

export interface CustomerPaymentMethod {
  id: string;
  customer_id: string;
  gateway: string;
  gateway_customer_id: string;
  gateway_method_id: string;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: number;
  consent_text: string | null;
  consent_at: string | null;
  created_at: string;
}

export function listMethodsForCustomer(customerId: string): CustomerPaymentMethod[] {
  return getDb()
    .query(
      `SELECT * FROM customer_payment_methods
       WHERE customer_id = ? ORDER BY is_default DESC, created_at ASC`,
    )
    .all(customerId) as CustomerPaymentMethod[];
}

export function getDefaultMethod(customerId: string): CustomerPaymentMethod | null {
  return getDb()
    .query(
      `SELECT * FROM customer_payment_methods
       WHERE customer_id = ? AND is_default = 1 LIMIT 1`,
    )
    .get(customerId) as CustomerPaymentMethod | null;
}

export function getMethodById(id: string): CustomerPaymentMethod | null {
  return getDb()
    .query("SELECT * FROM customer_payment_methods WHERE id = ?")
    .get(id) as CustomerPaymentMethod | null;
}

/**
 * Persist a tokenised method. Idempotent on (gateway, gateway_method_id): a
 * replayed webhook updates the display metadata instead of adding a row. The
 * first method a customer saves becomes their default; later ones do not
 * silently take over the card that recurring profiles are already billing.
 */
export function saveMethod(input: {
  customerId: string;
  gateway?: string;
  gatewayCustomerId: string;
  gatewayMethodId: string;
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
  consentText?: string | null;
}): CustomerPaymentMethod {
  const db = getDb();
  const gateway = input.gateway ?? "stripe";

  const existing = db
    .query("SELECT * FROM customer_payment_methods WHERE gateway = ? AND gateway_method_id = ?")
    .get(gateway, input.gatewayMethodId) as CustomerPaymentMethod | null;

  if (existing) {
    db.run(
      `UPDATE customer_payment_methods
       SET brand = COALESCE(?, brand), last4 = COALESCE(?, last4),
           exp_month = COALESCE(?, exp_month), exp_year = COALESCE(?, exp_year)
       WHERE id = ?`,
      [
        input.brand ?? null,
        input.last4 ?? null,
        input.expMonth ?? null,
        input.expYear ?? null,
        existing.id,
      ],
    );
    return getMethodById(existing.id)!;
  }

  const hasDefault = !!getDefaultMethod(input.customerId);
  const id = crypto.randomBytes(16).toString("hex");

  db.run(
    `INSERT INTO customer_payment_methods
       (id, customer_id, gateway, gateway_customer_id, gateway_method_id,
        brand, last4, exp_month, exp_year, is_default, consent_text, consent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.customerId,
      gateway,
      input.gatewayCustomerId,
      input.gatewayMethodId,
      input.brand ?? null,
      input.last4 ?? null,
      input.expMonth ?? null,
      input.expYear ?? null,
      hasDefault ? 0 : 1,
      input.consentText ?? null,
      input.consentText ? new Date().toISOString() : null,
    ],
  );

  return getMethodById(id)!;
}

/**
 * Revoke a method. Detaching at the gateway comes first: if that fails we keep
 * the row, so local state never claims a card is gone while Stripe still holds
 * it and could still be charged.
 */
export async function deleteMethod(
  id: string,
  customerId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const method = getMethodById(id);
  if (!method || method.customer_id !== customerId) {
    return { success: false, error: "Payment method not found" };
  }

  if (method.gateway === "stripe") {
    try {
      const stripe = await getStripe();
      await stripe.paymentMethods.detach(method.gateway_method_id);
    } catch (err: any) {
      // A method Stripe has already lost is fine to drop locally; anything else
      // must keep the row so the customer is not told it is revoked when it is not.
      const code = err?.code ?? err?.raw?.code;
      if (code !== "resource_missing") {
        logger.error({ err, methodId: id }, "Stripe detach failed, keeping local method");
        return { success: false, error: "Could not revoke the card at the payment provider" };
      }
    }
  }

  const db = getDb();
  const wasDefault = method.is_default === 1;
  db.run("DELETE FROM customer_payment_methods WHERE id = ?", [id]);

  if (wasDefault) {
    const next = db
      .query(
        `SELECT id FROM customer_payment_methods
         WHERE customer_id = ? ORDER BY created_at ASC LIMIT 1`,
      )
      .get(customerId) as { id: string } | null;
    if (next) {
      db.run("UPDATE customer_payment_methods SET is_default = 1 WHERE id = ?", [next.id]);
    }
  }

  return { success: true };
}
