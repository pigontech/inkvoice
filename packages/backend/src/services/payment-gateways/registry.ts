import { getSetting } from "../settings.service";
import { paypalGateway } from "./paypal.gateway";
import { stripeGateway } from "./stripe.gateway";
import type { PaymentGateway } from "./types";

// All known gateways, in the order they should appear to payers.
const GATEWAYS: readonly PaymentGateway[] = [stripeGateway, paypalGateway];

export function getGateway(id: string): PaymentGateway | undefined {
  return GATEWAYS.find((g) => g.id === id);
}

/**
 * Extension point for "is this gateway enabled" when a deployment has no
 * merchant-facing Settings toggle to read. Cloud tenants connect a gateway by
 * storing their own encrypted credentials (see `payment_credentials` in the
 * cloud overlay) rather than by flipping `${id}_enabled` in Settings, which
 * cloud never writes, so an overlay registers a checker that answers per
 * gateway id from its own source of truth instead of inkvoice keeping a
 * second copy of the flag. Returning null for a given id defers to the
 * Settings toggle for that id. Self-hosted never registers one, so the
 * Settings-based gate below is unchanged.
 */
export type GatewayEnabledChecker = (gatewayId: string) => boolean | null;
let gatewayEnabledChecker: GatewayEnabledChecker | null = null;
export function setGatewayEnabledChecker(checker: GatewayEnabledChecker | null): void {
  gatewayEnabledChecker = checker;
}

/** True when a gateway has credentials AND is toggled on (Settings, or the registered checker). */
export function isGatewayEnabled(gateway: PaymentGateway): boolean {
  if (!gateway.isConfigured()) return false;
  const answer = gatewayEnabledChecker ? gatewayEnabledChecker(gateway.id) : null;
  if (answer !== null) return answer;
  return getSetting(`${gateway.id}_enabled`) === "true";
}

/** Gateways available to payers right now (configured ∧ enabled). */
export function getEnabledGateways(): PaymentGateway[] {
  return GATEWAYS.filter(isGatewayEnabled);
}

/** Public-safe descriptor (no credentials) for the invoice page. */
export function listEnabledGatewayMeta(): Array<{ id: string; label: string }> {
  return getEnabledGateways().map((g) => ({ id: g.id, label: g.label }));
}

/** Enabled gateways that can charge a stored method with nobody present. */
export function getAutoBillGateways(): PaymentGateway[] {
  return getEnabledGateways().filter((g) => g.supportsAutoBill === true);
}
