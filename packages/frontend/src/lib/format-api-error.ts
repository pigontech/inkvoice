import { ApiError } from "@/api/client";
import type { TFunction } from "@/i18n";

/**
 * User-facing message for API failures and thrown errors.
 *
 * Resolution order:
 * 1. If the backend returned a `code`, use it to pick a translated message.
 * 2. Otherwise fall back to status-based heuristics, preferring the message the
 *    backend sent if it's specific (i.e. not the generic "Request failed").
 * 3. As a last resort, use a generic translated string.
 */
export function formatApiError(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    // Code-based resolution (preferred — backend tells us what went wrong)
    switch (err.code) {
      case "UNAUTHORIZED":
        return t("common.error_session_expired");
      case "FORBIDDEN":
        return t("common.error_forbidden");
      case "PAYLOAD_TOO_LARGE":
        return t("common.error_request_too_large");
      case "INTERNAL_ERROR":
        return t("common.error_server");
      case "VALIDATION_FAILED":
        if (err.errors) {
          const first = Object.values(err.errors)
            .flat()
            .find((m) => typeof m === "string" && m.length > 0);
          if (first) return first;
        }
        if (err.message && err.message !== "Request failed") return err.message;
        return t("common.error_request_failed");
    }

    // Status-based fallback for legacy responses without a code
    if (err.status === 401) {
      if (err.message && err.message !== "Unauthorized" && err.message !== "Request failed") {
        return err.message;
      }
      return t("common.error_session_expired");
    }
    if (err.status === 403) {
      return err.message && err.message !== "Request failed"
        ? err.message
        : t("common.error_forbidden");
    }
    if (err.status === 413) {
      return t("common.error_request_too_large");
    }
    if (err.status === 500) {
      return t("common.error_server");
    }
    if (err.status === 400 && err.errors && Object.keys(err.errors).length > 0) {
      const first = Object.values(err.errors)
        .flat()
        .find((m) => typeof m === "string" && m.length > 0);
      if (first) return first;
    }
    if (err.status === 502 || err.status === 503) {
      return err.message && err.message !== "Request failed"
        ? err.message
        : t("common.error_unavailable");
    }
    if (err.message && err.message !== "Request failed" && err.message !== "Unauthorized") {
      return err.message;
    }
    return t("common.error_request_failed");
  }
  if (err instanceof Error) {
    if (err.message === "Unauthorized") return t("common.error_session_expired");
    if (err.message) return err.message;
  }
  return t("common.error_request_failed");
}
