/**
 * The icons, from the favicon in config/brand.json: favicon.svg, favicon.ico (16, 32 and 48),
 * the 16 and 32 pixel PNG favicons, the 180 pixel apple-touch-icon and the 192 and 512 pixel
 * manifest icons, written identically into site/ (map.igred.org) and www/ (igred.org).
 *
 * Run: npx tsx scripts/build-icons.ts   (or through `npm run brand`; needs Playwright's Chromium)
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { faviconSvg } from '../src/core/brand.js';
import { repoRoot } from '../src/core/util/paths.js';

/** An .ico file holding PNG images, which every current browser reads. */
function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e); offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

export async function writeIcons(): Promise<void> {
  const svg = faviconSvg();
  const browser = await chromium.launch();
  try {
    // A window larger than any icon: Chromium will not make one as small as 16 pixels.
    const page = await browser.newPage({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
    const png: Record<number, Buffer> = {};
    // One at a time: they share the page.
    for (const size of [16, 32, 48, 180, 192, 512]) {
      await page.setContent(`<html><body style="margin:0;background:transparent;line-height:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
      png[size] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    }
    for (const dir of ['site', 'www']) {
      const out = (f: string, data: string | Buffer) => writeFileSync(path.join(repoRoot, dir, f), data);
      out('favicon.svg', svg);
      out('favicon-16.png', png[16]!);
      out('favicon-32.png', png[32]!);
      out('apple-touch-icon.png', png[180]!);
      out('icon-192.png', png[192]!);
      out('icon-512.png', png[512]!);
      out('favicon.ico', ico([16, 32, 48].map((s) => ({ size: s, data: png[s]! }))));
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeIcons();
  console.log('icons: written to site/ and www/');
}
