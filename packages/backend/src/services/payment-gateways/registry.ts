import { getSetting } from "../settings.service";
import { paypalGateway } from "./paypal.gateway";
import { stripeGateway } from "./stripe.gateway";
import type { PaymentGateway } from "./types";

// All known gateways, in the order they should appear to payers.
const GATEWAYS: readonly PaymentGateway[] = [stripeGateway, paypalGateway];

export function getGateway(id: string): PaymentGateway | undefined {
  return GATEWAYS.find((g) => g.id === id);
}

/** True when a gateway has credentials AND is toggled on in Settings. */
export function isGatewayEnabled(gateway: PaymentGateway): boolean {
  return gateway.isConfigured() && getSetting(`${gateway.id}_enabled`) === "true";
}

/** Gateways available to payers right now (configured ∧ enabled). */
export function getEnabledGateways(): PaymentGateway[] {
  return GATEWAYS.filter(isGatewayEnabled);
}

/** Public-safe descriptor (no credentials) for the invoice page. */
export function listEnabledGatewayMeta(): Array<{ id: string; label: string }> {
  return getEnabledGateways().map((g) => ({ id: g.id, label: g.label }));
}
