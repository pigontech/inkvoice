// Injectable, read-only plan-feature policy, the counterpart to feature-gate.ts.
// feature-gate.ts decides whether a REQUEST is allowed; this decides whether the
// catalog should show an enable switch at all. OSS ships no plans, so the
// default is null, meaning everything is entitled and OSS behaviour is
// unchanged. An overlay installs its resolver at boot alongside
// setPluginFeatureGate.
//
// The two must agree. A plugin whose gate denies at request time while this
// says yes would render an enable switch that produces a 402.

/** Receives a plugin's `feature` id (for example "time-tracker"), not a plan name. */
export type PluginEntitlementCheck = (feature: string) => boolean;

let entitlementCheck: PluginEntitlementCheck | null = null;

export function setPluginEntitlementCheck(fn: PluginEntitlementCheck | null): void {
  entitlementCheck = fn;
}

export function getPluginEntitlementCheck(): PluginEntitlementCheck | null {
  return entitlementCheck;
}
