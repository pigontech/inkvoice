/**
 * Stable, machine-readable identifiers for common error categories. Routes are
 * free to ignore this and just throw with `(status, message)`, but using a code
 * lets the client distinguish e.g. "couldn't find a customer" from "couldn't
 * find an invoice" without string-matching the message.
 *
 * Add new codes here as needed — they're additive, not exhaustive.
 */
export type ErrorCode =
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "PLAN_LIMIT"
  | "INTERNAL_ERROR";

export class HttpError extends Error {
  readonly status: number;
  readonly errors?: Record<string, string[]>;
  readonly code?: ErrorCode;

  constructor(
    status: number,
    message: string,
    errors?: Record<string, string[]>,
    code?: ErrorCode,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.errors = errors;
    this.code = code;
  }
}
