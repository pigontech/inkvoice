import type { TFunction } from "@/i18n";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(
  timestamp: number,
  t: TFunction,
  now: number = Date.now(),
): string {
  const diff = now - timestamp;
  if (diff < 5 * SECOND) return t("common.just_now");
  if (diff < MINUTE) return t("common.seconds_ago", { count: String(Math.floor(diff / SECOND)) });
  if (diff < HOUR) return t("common.minutes_ago", { count: String(Math.floor(diff / MINUTE)) });
  if (diff < DAY) return t("common.hours_ago", { count: String(Math.floor(diff / HOUR)) });
  return t("common.days_ago", { count: String(Math.floor(diff / DAY)) });
}
