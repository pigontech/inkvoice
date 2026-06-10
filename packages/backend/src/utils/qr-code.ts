/**
 * Minimal QR Code generator (byte mode, error correction level M).
 *
 * Supports versions 1–10 (21×21 to 57×57 modules), enough to encode any
 * typical invoice URL. Auto-picks the smallest version that fits the data.
 * Output: SVG markup, suitable for embedding as a data URI in a PDF template.
 *
 * Based on the QR Code spec (ISO/IEC 18004) — implemented from scratch to
 * avoid pulling in a 100 KB dependency for a single feature.
 */

// --- Galois field GF(256) for Reed-Solomon error correction ---
// Primitive polynomial: 0x11D (x^8 + x^4 + x^3 + x^2 + 1).
const GF_EXP = new Uint8Array(256);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  GF_EXP[255] = GF_EXP[0];
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
}

// Reed-Solomon generator polynomial of given degree.
function rsGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, generator: Uint8Array): Uint8Array {
  const result = new Uint8Array(generator.length - 1);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let j = 0; j < generator.length - 1; j++) {
      result[j] ^= gfMul(generator[j + 1], factor);
    }
  }
  return result;
}

// --- QR specs: versions 1-10 at error correction level M ---
// Each row: [total_codewords, ec_codewords_per_block, num_blocks_group1, data_codewords_g1, num_blocks_group2, data_codewords_g2]
// Source: QR spec table 9.
const ECM_BLOCKS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  /* v1  */ [26, 10, 1, 16, 0, 0],
  /* v2  */ [44, 16, 1, 28, 0, 0],
  /* v3  */ [70, 26, 1, 44, 0, 0],
  /* v4  */ [100, 18, 2, 32, 0, 0],
  /* v5  */ [134, 24, 2, 43, 0, 0],
  /* v6  */ [172, 16, 4, 27, 0, 0],
  /* v7  */ [196, 18, 4, 31, 0, 0],
  /* v8  */ [242, 22, 2, 38, 2, 39],
  /* v9  */ [292, 22, 3, 36, 2, 37],
  /* v10 */ [346, 26, 4, 43, 1, 44],
];

// Alignment-pattern center coordinates per version (versions 2-10).
const ALIGNMENT_CENTERS: ReadonlyArray<readonly number[]> = [
  /* v2  */ [6, 18],
  /* v3  */ [6, 22],
  /* v4  */ [6, 26],
  /* v5  */ [6, 30],
  /* v6  */ [6, 34],
  /* v7  */ [6, 22, 38],
  /* v8  */ [6, 24, 42],
  /* v9  */ [6, 26, 46],
  /* v10 */ [6, 28, 50],
];

// Format info bits for level M masked with 0x5412 (per spec).
const FORMAT_INFO_M: ReadonlyArray<number> = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
];

interface BitBuffer {
  bits: number[];
}

function appendBits(bb: BitBuffer, value: number, nBits: number): void {
  for (let i = nBits - 1; i >= 0; i--) {
    bb.bits.push((value >>> i) & 1);
  }
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Pick the smallest version (1-10, M-level) that fits the given data length.
 * Throws if data exceeds version-10 capacity.
 */
function pickVersion(dataLen: number): number {
  for (let v = 1; v <= 10; v++) {
    const spec = ECM_BLOCKS[v - 1];
    const ecPerBlock = spec[1];
    const totalEcCodewords = ecPerBlock * (spec[2] + spec[4]);
    const dataCodewords = spec[0] - totalEcCodewords;
    // Mode (4) + char count (8 for v1-9, 16 for v10) + data*8 + terminator (≤4)
    const charCountBits = v < 10 ? 8 : 16;
    const requiredBits = 4 + charCountBits + dataLen * 8;
    if (requiredBits <= dataCodewords * 8) return v;
  }
  throw new Error(`QR data too large for version 10 (${dataLen} bytes)`);
}

function buildDataCodewords(data: Uint8Array, version: number): Uint8Array {
  const spec = ECM_BLOCKS[version - 1];
  const ecPerBlock = spec[1];
  const totalEc = ecPerBlock * (spec[2] + spec[4]);
  const dataCodewords = spec[0] - totalEc;
  const charCountBits = version < 10 ? 8 : 16;

  const bb: BitBuffer = { bits: [] };
  appendBits(bb, 0b0100, 4); // byte mode
  appendBits(bb, data.length, charCountBits);
  for (const b of data) appendBits(bb, b, 8);

  // Terminator (up to 4 zero bits)
  const remaining = dataCodewords * 8 - bb.bits.length;
  appendBits(bb, 0, Math.min(4, remaining));
  // Pad to next byte boundary
  while (bb.bits.length % 8 !== 0) bb.bits.push(0);
  // Pad bytes alternating 0xEC, 0x11
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bb.bits.length < dataCodewords * 8) {
    appendBits(bb, padBytes[padIdx], 8);
    padIdx ^= 1;
  }

  // Pack bits into bytes
  const out = new Uint8Array(dataCodewords);
  for (let i = 0; i < dataCodewords; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bb.bits[i * 8 + b];
    out[i] = byte;
  }
  return out;
}

/** Split data into per-block arrays per QR spec, attach EC codewords, then interleave. */
function buildFinalCodewords(dataCodewords: Uint8Array, version: number): Uint8Array {
  const spec = ECM_BLOCKS[version - 1];
  const ecPerBlock = spec[1];
  const numBlocks1 = spec[2];
  const dataPerBlock1 = spec[3];
  const numBlocks2 = spec[4];
  const dataPerBlock2 = spec[5];
  const totalBlocks = numBlocks1 + numBlocks2;
  const generator = rsGenerator(ecPerBlock);

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < numBlocks1; i++) {
    const block = dataCodewords.subarray(offset, offset + dataPerBlock1);
    offset += dataPerBlock1;
    dataBlocks.push(block);
    ecBlocks.push(rsRemainder(block, generator));
  }
  for (let i = 0; i < numBlocks2; i++) {
    const block = dataCodewords.subarray(offset, offset + dataPerBlock2);
    offset += dataPerBlock2;
    dataBlocks.push(block);
    ecBlocks.push(rsRemainder(block, generator));
  }

  // Interleave: column-major
  const maxData = Math.max(dataPerBlock1, dataPerBlock2 || 0);
  const result: number[] = [];
  for (let i = 0; i < maxData; i++) {
    for (let b = 0; b < totalBlocks; b++) {
      if (i < dataBlocks[b].length) result.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < totalBlocks; b++) {
      result.push(ecBlocks[b][i]);
    }
  }
  return new Uint8Array(result);
}

// --- Matrix construction ---
type Matrix = {
  size: number;
  modules: boolean[][]; // true = dark
  reserved: boolean[][];
};

function newMatrix(size: number): Matrix {
  const modules: boolean[][] = [];
  const reserved: boolean[][] = [];
  for (let i = 0; i < size; i++) {
    modules.push(new Array(size).fill(false));
    reserved.push(new Array(size).fill(false));
  }
  return { size, modules, reserved };
}

function placeFinder(m: Matrix, r: number, c: number): void {
  for (let i = -1; i <= 7; i++) {
    for (let j = -1; j <= 7; j++) {
      const rr = r + i;
      const cc = c + j;
      if (rr < 0 || rr >= m.size || cc < 0 || cc >= m.size) continue;
      m.reserved[rr][cc] = true;
      const inner =
        i >= 0 &&
        i <= 6 &&
        j >= 0 &&
        j <= 6 &&
        (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4));
      m.modules[rr][cc] = inner;
    }
  }
}

function placeAlignment(m: Matrix, r: number, c: number): void {
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      m.reserved[r + i][c + j] = true;
      const onEdge = i === -2 || i === 2 || j === -2 || j === 2;
      const center = i === 0 && j === 0;
      m.modules[r + i][c + j] = onEdge || center;
    }
  }
}

function placeTimingPatterns(m: Matrix): void {
  for (let i = 8; i < m.size - 8; i++) {
    m.modules[6][i] = i % 2 === 0;
    m.modules[i][6] = i % 2 === 0;
    m.reserved[6][i] = true;
    m.reserved[i][6] = true;
  }
}

function reserveFormatInfo(m: Matrix): void {
  // Around top-left finder
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      m.reserved[8][i] = true;
      m.reserved[i][8] = true;
    }
  }
  // Top-right (row 8)
  for (let i = m.size - 8; i < m.size; i++) {
    m.reserved[8][i] = true;
  }
  // Bottom-left (column 8)
  for (let i = m.size - 8; i < m.size; i++) {
    m.reserved[i][8] = true;
  }
  // Dark module (always set, never masked)
  m.modules[m.size - 8][8] = true;
  m.reserved[m.size - 8][8] = true;
}

function buildBaseMatrix(version: number): Matrix {
  const size = 17 + version * 4;
  const m = newMatrix(size);
  // Three finder patterns
  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);
  // Separator lines are blank-by-default; reserved by placeFinder via -1..7 loop.
  // Timing patterns
  placeTimingPatterns(m);
  // Alignment patterns (versions ≥ 2)
  if (version >= 2) {
    const centers = ALIGNMENT_CENTERS[version - 2];
    for (const a of centers) {
      for (const b of centers) {
        // Skip alignment pattern overlapping finder patterns
        if ((a === 6 && (b === 6 || b === size - 7)) || (a === size - 7 && b === 6)) {
          continue;
        }
        placeAlignment(m, a, b);
      }
    }
  }
  reserveFormatInfo(m);
  return m;
}

function placeData(m: Matrix, data: Uint8Array): void {
  const size = m.size;
  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip vertical timing column
    for (let vert = 0; vert < size; vert++) {
      const row = upward ? size - 1 - vert : vert;
      for (let i = 0; i < 2; i++) {
        const col = right - i;
        if (m.reserved[row][col]) continue;
        if (bitIdx < data.length * 8) {
          const byte = data[bitIdx >>> 3];
          const bit = (byte >>> (7 - (bitIdx & 7))) & 1;
          m.modules[row][col] = bit === 1;
          bitIdx++;
        }
      }
    }
    upward = !upward;
  }
}

function maskFn(mask: number): (r: number, c: number) => boolean {
  switch (mask) {
    case 0:
      return (r, c) => (r + c) % 2 === 0;
    case 1:
      return (r) => r % 2 === 0;
    case 2:
      return (_, c) => c % 3 === 0;
    case 3:
      return (r, c) => (r + c) % 3 === 0;
    case 4:
      return (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7:
      return (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      throw new Error("invalid mask");
  }
}

function applyMask(m: Matrix, mask: number): void {
  const fn = maskFn(mask);
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.reserved[r][c]) continue;
      if (fn(r, c)) m.modules[r][c] = !m.modules[r][c];
    }
  }
}

function placeFormatInfo(m: Matrix, mask: number): void {
  const bits = FORMAT_INFO_M[mask];
  // Around top-left finder + top-right & bottom-left segments per spec.
  for (let i = 0; i < 15; i++) {
    const bit = ((bits >>> i) & 1) === 1;
    // First copy: 6 bits along row 8 (cols 0..5), col 7, col 8, row 7, then up col 8 (rows 5..0).
    if (i < 6) m.modules[8][i] = bit;
    else if (i === 6) m.modules[8][7] = bit;
    else if (i === 7) m.modules[8][8] = bit;
    else if (i === 8) m.modules[7][8] = bit;
    else m.modules[14 - i][8] = bit;

    // Second copy: 7 bits down col 8 (rows size-1..size-7), then 8 bits along row 8 (cols size-8..size-1).
    // The cell at (size-8, 8) is the always-dark module and is NOT part of format info.
    if (i < 7) m.modules[m.size - 1 - i][8] = bit;
    else m.modules[8][m.size - 15 + i] = bit;
  }
  // Restore the always-dark module — the second copy of format info skips it,
  // but defending against accidental overwrite is cheap.
  m.modules[m.size - 8][8] = true;
}

function maskPenalty(m: Matrix): number {
  const size = m.size;
  let penalty = 0;
  // Rule 1: runs of 5+ same-color in a row/column → 3 + (run-5)
  for (let i = 0; i < size; i++) {
    let runR = 1,
      prevR = m.modules[i][0];
    let runC = 1,
      prevC = m.modules[0][i];
    for (let j = 1; j < size; j++) {
      if (m.modules[i][j] === prevR) runR++;
      else {
        if (runR >= 5) penalty += 3 + (runR - 5);
        runR = 1;
        prevR = m.modules[i][j];
      }
      if (m.modules[j][i] === prevC) runC++;
      else {
        if (runC >= 5) penalty += 3 + (runC - 5);
        runC = 1;
        prevC = m.modules[j][i];
      }
    }
    if (runR >= 5) penalty += 3 + (runR - 5);
    if (runC >= 5) penalty += 3 + (runC - 5);
  }
  // Rule 2: 2x2 same-color block → 3
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m.modules[r][c];
      if (v === m.modules[r + 1][c] && v === m.modules[r][c + 1] && v === m.modules[r + 1][c + 1]) {
        penalty += 3;
      }
    }
  }
  // Rule 3: finder-like patterns 1011101 with 4-module light buffer either side → 40
  const pattern1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pattern2 = [false, false, false, false, true, false, true, true, true, false, true];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      let m1 = true,
        m2 = true;
      for (let k = 0; k < 11; k++) {
        if (m.modules[r][c + k] !== pattern1[k]) m1 = false;
        if (m.modules[r][c + k] !== pattern2[k]) m2 = false;
      }
      if (m1 || m2) penalty += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      let m1 = true,
        m2 = true;
      for (let k = 0; k < 11; k++) {
        if (m.modules[r + k][c] !== pattern1[k]) m1 = false;
        if (m.modules[r + k][c] !== pattern2[k]) m2 = false;
      }
      if (m1 || m2) penalty += 40;
    }
  }
  // Rule 4: dark-module proportion deviation → 10 per 5%
  let darkCount = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m.modules[r][c]) darkCount++;
  const ratio = (darkCount * 100) / (size * size);
  const deviation = Math.floor(Math.abs(ratio - 50) / 5);
  penalty += deviation * 10;
  return penalty;
}

function chooseBestMask(
  version: number,
  finalCodewords: Uint8Array,
): { matrix: Matrix; mask: number } {
  let best: { matrix: Matrix; mask: number; penalty: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = buildBaseMatrix(version);
    placeData(m, finalCodewords);
    applyMask(m, mask);
    placeFormatInfo(m, mask);
    const penalty = maskPenalty(m);
    if (!best || penalty < best.penalty) best = { matrix: m, mask, penalty };
  }
  return best!;
}

/**
 * Encode `text` to a QR code matrix (level M). Returns a 2D boolean array
 * (true = dark module) and the side length.
 */
export function encodeQR(text: string): { size: number; modules: boolean[][] } {
  const data = utf8Bytes(text);
  const version = pickVersion(data.length);
  const dataCodewords = buildDataCodewords(data, version);
  const finalCodewords = buildFinalCodewords(dataCodewords, version);
  const { matrix } = chooseBestMask(version, finalCodewords);
  return { size: matrix.size, modules: matrix.modules };
}

/**
 * Render a QR code as compact SVG. The SVG uses module-units (1 module = 1 user
 * unit) so it scales freely; consumers set the rendered size via width/height
 * or CSS. A `border` (in modules, default 4) is the quiet zone.
 */
export function qrToSvg(
  text: string,
  options: { border?: number; dark?: string; light?: string } = {},
): string {
  const border = options.border ?? 4;
  const dark = options.dark ?? "#000000";
  const light = options.light ?? "#ffffff";
  const { size, modules } = encodeQR(text);
  const dim = size + border * 2;

  const paths: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) paths.push(`M${c + border},${r + border}h1v1h-1z`);
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
    `<rect width="100%" height="100%" fill="${light}"/>` +
    `<path d="${paths.join("")}" fill="${dark}"/>` +
    `</svg>`
  );
}

/** Convenience: data-URI form for direct use as <img src="..."/>. */
export function qrToDataUri(text: string, options?: Parameters<typeof qrToSvg>[1]): string {
  const svg = qrToSvg(text, options);
  // Use base64 to ensure the URI is safe regardless of SVG content.
  const b64 = Buffer.from(svg, "utf-8").toString("base64");
  return `data:image/svg+xml;base64,${b64}`;
}
