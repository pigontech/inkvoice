// Best-effort filter so automated fetches (link unfurlers, our own PDF render,
// crawlers, monitors) don't get counted as a client "viewing" an invoice. This
// is intentionally conservative — a missed bot just over-counts a view; it
// never blocks a real client.
const BOT_PATTERNS = [
  "bot",
  "crawler",
  "spider",
  "slurp",
  "facebookexternalhit",
  "whatsapp",
  "telegrambot",
  "slackbot",
  "twitterbot",
  "discordbot",
  "linkedinbot",
  "embedly",
  "preview",
  "curl",
  "wget",
  "python-requests",
  "go-http-client",
  "headlesschrome",
  "puppeteer",
  "playwright",
  "lighthouse",
  "pingdom",
  "uptimerobot",
];

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true; // no UA at all → almost always automated
  const ua = userAgent.toLowerCase();
  return BOT_PATTERNS.some((p) => ua.includes(p));
}
