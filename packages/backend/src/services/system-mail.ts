// Extension point: platform-managed transactional mail (password reset and
// the like). A hosting deployment can register a branded sender here; a
// standalone install has none registered and callers fall back to their own
// delivery (or skip sending). Mirrors setTenantSmtpResolver,
// setRecurringLimitChecker, and setHealthChecks.

export interface SystemMailRequest {
  to: string;
  template: string;
  locale?: string;
  vars: Record<string, string>;
  /**
   * Subject line override. May contain {{...}} placeholders the registered
   * sender renders against `vars`.
   */
  subject?: string;
}

export interface SystemMailSendResult {
  success: boolean;
  error?: string;
}

export type SystemMailSender = (input: SystemMailRequest) => Promise<SystemMailSendResult>;

let sender: SystemMailSender | null = null;

export function setSystemMailSender(fn: SystemMailSender | null): void {
  sender = fn;
}

export function getSystemMailSender(): SystemMailSender | null {
  return sender;
}
