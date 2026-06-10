import { resolve4, resolve6 } from "node:dns/promises";

/**
 * Validate a URL for safe fetching — rejects non-HTTPS and private/internal IPs.
 */
export async function validateUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are allowed");
  }

  const hostname = parsed.hostname;

  // Block obvious localhost / loopback
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0"
  ) {
    throw new Error("URLs pointing to localhost are not allowed");
  }

  // Resolve DNS and check for private IP ranges
  try {
    const ips = await resolve4(hostname).catch(() => [] as string[]);
    const ipv6 = await resolve6(hostname).catch(() => [] as string[]);

    const allIps = [...ips, ...ipv6];

    for (const ip of allIps) {
      if (isPrivateIp(ip)) {
        throw new Error("URLs pointing to private/internal networks are not allowed");
      }
    }
  } catch (err: any) {
    if (err.message?.includes("not allowed")) {
      throw err;
    }
    // DNS resolution failure — allow through (could be a valid host we can't resolve locally)
  }
}

function isPrivateIp(ip: string): boolean {
  // IPv6 loopback
  if (ip === "::1" || ip === "::") return true;

  // IPv4 checks
  const parts = ip.split(".").map(Number);
  if (parts.length === 4) {
    // 127.x.x.x (loopback)
    if (parts[0] === 127) return true;
    // 10.x.x.x (private)
    if (parts[0] === 10) return true;
    // 172.16.0.0 - 172.31.255.255 (private)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.x.x (private)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.x.x (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0
    if (parts[0] === 0) return true;
  }

  return false;
}
