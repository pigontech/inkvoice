// Extension point: an overlay can provide an online-payment flow for the
// client portal ("Pay now" on an invoice). The portal page shows the pay
// button only when both the server reports payments as available and a
// handler is registered.

export interface PortalPayRequest {
  invoice_id: string;
  amount: number;
  currency: string;
  description: string;
}

/** Returns the checkout redirect URL, or null when no session could be created. */
export type PortalPayHandler = (req: PortalPayRequest) => Promise<{ url: string } | null>;

let handler: PortalPayHandler | null = null;

export function setPortalPayHandler(fn: PortalPayHandler | null): void {
  handler = fn;
}

export function getPortalPayHandler(): PortalPayHandler | null {
  return handler;
}
