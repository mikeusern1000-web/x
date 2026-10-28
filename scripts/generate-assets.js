import fs from 'node:fs';
import zlib from 'node:zlib';

function createPng(width, height, pixelFn) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8-bit depth
  ihdrData.writeUInt8(6, 9); // RGBA (color type 6)
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type);
    const crcVal = zlib.crc32(Buffer.concat([typeBuf, data]));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcVal >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const ihdrChunk = chunk('IHDR', ihdrData);

  // Raw RGBA scanlines
  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const [r, g, b, a] = pixelFn(x, y, width, height);
      raw[pxOffset] = r;
      raw[pxOffset + 1] = g;
      raw[pxOffset + 2] = b;
      raw[pxOffset + 3] = a !== undefined ? a : 255;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const idatChunk = chunk('IDAT', compressed);
  const iendChunk = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Helper: check if point (x,y) is inside lightning bolt
function insideBolt(nx, ny) {
  // Normalized coords [0, 1] within a unit box
  // Vertex coordinates of bolt: (0.56, 0.12), (0.24, 0.54), (0.48, 0.54), (0.42, 0.88), (0.76, 0.44), (0.50, 0.44)
  // Polygon check:
  const poly = [
    [0.56, 0.12],
    [0.24, 0.54],
    [0.48, 0.54],
    [0.42, 0.88],
    [0.76, 0.44],
    [0.50, 0.44]
  ];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > ny) !== (yj > ny)) &&
      (nx < (xj - xi) * (ny - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Generate App Icon (192x192 and 512x512)
function generateIcon(size) {
  return createPng(size, size, (x, y, w, h) => {
    const rCorner = size * 0.22;
    // Check rounded rect
    let inCard = false;
    const dx = Math.min(x, w - 1 - x);
    const dy = Math.min(y, h - 1 - y);
    if (dx >= rCorner || dy >= rCorner) {
      inCard = true;
    } else {
      const cx = rCorner - dx;
      const cy = rCorner - dy;
      if (cx * cx + cy * cy <= rCorner * rCorner) inCard = true;
    }

    if (!inCard) return [0, 0, 0, 0]; // Transparent outside

    // Inside card: amber gradient
    const progress = (x + y) / (w + h);
    const r = Math.round(251 - progress * 15); // #fbbf24 to #f59e0b
    const g = Math.round(191 - progress * 33);
    const b = Math.round(36 - progress * 25);

    // Bolt inside icon
    const pad = size * 0.16;
    const innerSize = size - pad * 2;
    if (x >= pad && x <= size - pad && y >= pad && y <= size - pad) {
      const nx = (x - pad) / innerSize;
      const ny = (y - pad) / innerSize;
      if (insideBolt(nx, ny)) {
        return [2, 6, 23, 255]; // Slate-950 #020617
      }
    }

    return [r, g, b, 255];
  });
}

// Generate OpenGraph Banner 1200 x 630
function generateOgImage() {
  return createPng(1200, 630, (x, y, w, h) => {
    // Top border glow (Amber #f59e0b)
    if (y < 6) return [245, 158, 11, 255];

    // Background gradient: dark slate 950 (#020617) to 900 (#0f172a)
    const distCenter = Math.sqrt(Math.pow((x - 600) / 600, 2) + Math.pow((y - 315) / 315, 2));
    let r = Math.round(2 + (1 - Math.min(distCenter, 1)) * 14);
    let g = Math.round(6 + (1 - Math.min(distCenter, 1)) * 18);
    let b = Math.round(23 + (1 - Math.min(distCenter, 1)) * 25);

    // Subtle glow circles
    const dGlow1 = Math.sqrt(Math.pow(x - 980, 2) + Math.pow(y - 180, 2));
    if (dGlow1 < 260) {
      const factor = (1 - dGlow1 / 260) * 0.22;
      r = Math.min(255, Math.round(r + 245 * factor));
      g = Math.min(255, Math.round(g + 158 * factor));
      b = Math.min(255, Math.round(b + 11 * factor));
    }
    const dGlow2 = Math.sqrt(Math.pow(x - 220, 2) + Math.pow(y - 480, 2));
    if (dGlow2 < 220) {
      const factor = (1 - dGlow2 / 220) * 0.18;
      r = Math.min(255, Math.round(r + 14 * factor));
      g = Math.min(255, Math.round(g + 165 * factor));
      b = Math.min(255, Math.round(b + 233 * factor));
    }

    // Logo icon badge at (100, 90) size 110x110
    const bx = 100, by = 90, bsize = 110, br = 26;
    if (x >= bx && x <= bx + bsize && y >= by && y <= by + bsize) {
      const ldx = Math.min(x - bx, bx + bsize - x);
      const ldy = Math.min(y - by, by + bsize - y);
      let inLogo = true;
      if (ldx < br && ldy < br) {
        if ((br - ldx) ** 2 + (br - ldy) ** 2 > br ** 2) inLogo = false;
      }
      if (inLogo) {
        const nx = (x - bx) / bsize;
        const ny = (y - by) / bsize;
        if (insideBolt(nx, ny)) {
          return [2, 6, 23, 255]; // Slate 950
        }
        return [245, 158, 11, 255]; // Amber
      }
    }

    // Modern tiered energy gauge preview cards at bottom (y: 430 to 520)
    // 4 country cards:
    const cardY = 440, cardH = 76;
    const countries = [
      { x: 100, w: 220, color: [220, 38, 38] }, // Tunisia (red)
      { x: 350, w: 220, color: [22, 163, 74] }, // Algeria (green)
      { x: 600, w: 220, color: [225, 29, 72] }, // Morocco (rose)
      { x: 850, w: 220, color: [234, 179, 8] }, // Libya (amber)
    ];

    for (const c of countries) {
      if (x >= c.x && x <= c.x + c.w && y >= cardY && y <= cardY + cardH) {
        const cdx = Math.min(x - c.x, c.x + c.w - x);
        const cdy = Math.min(y - cardY, cardY + cardH - y);
        let inC = true;
        if (cdx < 14 && cdy < 14) {
          if ((14 - cdx) ** 2 + (14 - cdy) ** 2 > 14 ** 2) inC = false;
        }
        if (inC) {
          // Left indicator bar
          if (x - c.x < 8) return [...c.color, 255];
          // Card border
          if (cdx <= 1 || cdy <= 1) return [51, 65, 85, 255]; // Slate-700
          // Card body
          return [15, 23, 42, 255]; // Slate-900
        }
      }
    }

    // Bottom subtle separator line
    if (y === 560 && x >= 100 && x <= 1100) return [30, 41, 59, 255];

    return [r, g, b, 255];
  });
}

// Generate files
fs.writeFileSync('public/icon-192.png', generateIcon(192));
fs.writeFileSync('public/icon-512.png', generateIcon(512));
fs.writeFileSync('public/og-image.png', generateOgImage());
console.log('Successfully generated public/icon-192.png, public/icon-512.png, and public/og-image.png');
