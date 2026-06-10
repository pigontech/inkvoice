/**
 * Extract dominant colors from an image URL using canvas pixel analysis.
 * Works with both data URLs (base64) and regular URLs.
 */
export async function extractColors(imageUrl: string, count = 5): Promise<string[]> {
  const img = await loadImage(imageUrl);
  const { data } = getPixelData(img);
  const colors = quantizeColors(data);
  return colors.slice(0, count);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

function getPixelData(img: HTMLImageElement): ImageData {
  const MAX_DIM = 100;
  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

interface ColorBucket {
  rSum: number;
  gSum: number;
  bSum: number;
  count: number;
}

const COLOR_DISTANCE_THRESHOLD = 30;

function rgbDistance(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function isNearWhite(r: number, g: number, b: number): boolean {
  return r > 240 && g > 240 && b > 240;
}

function isNearBlack(r: number, g: number, b: number): boolean {
  return r < 15 && g < 15 && b < 15;
}

function toHex(r: number, g: number, b: number): string {
  const hex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function quantizeColors(data: Uint8ClampedArray): string[] {
  const buckets: ColorBucket[] = [];

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    // Skip fully transparent pixels
    if (a < 128) continue;

    // Skip near-white and near-black
    if (isNearWhite(r, g, b) || isNearBlack(r, g, b)) continue;

    // Find closest existing bucket
    let merged = false;
    for (const bucket of buckets) {
      const avgR = bucket.rSum / bucket.count;
      const avgG = bucket.gSum / bucket.count;
      const avgB = bucket.bSum / bucket.count;
      if (rgbDistance(r, g, b, avgR, avgG, avgB) < COLOR_DISTANCE_THRESHOLD) {
        bucket.rSum += r;
        bucket.gSum += g;
        bucket.bSum += b;
        bucket.count++;
        merged = true;
        break;
      }
    }

    if (!merged) {
      buckets.push({ rSum: r, gSum: g, bSum: b, count: 1 });
    }
  }

  // Sort by frequency (most common first)
  buckets.sort((a, b) => b.count - a.count);

  // Convert to hex, deduplicate close colors in the final output
  const result: string[] = [];
  const resultRgb: [number, number, number][] = [];

  for (const bucket of buckets) {
    const avgR = bucket.rSum / bucket.count;
    const avgG = bucket.gSum / bucket.count;
    const avgB = bucket.bSum / bucket.count;

    // Ensure this color is sufficiently different from already-picked colors
    const tooClose = resultRgb.some(([r, g, b]) => rgbDistance(avgR, avgG, avgB, r, g, b) < 50);
    if (tooClose) continue;

    result.push(toHex(avgR, avgG, avgB));
    resultRgb.push([avgR, avgG, avgB]);
  }

  return result;
}
