// Team pictures from the sheet's "Images" tab: each team name is a header in
// row 1 with a picture placed over the cell below it. CSV exports leave
// pictures out, so this reads the workbook's .xlsx export, where each picture
// is a drawing anchored to a cell, and pairs it with the header of its column.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { unzipSync, strFromU8 } = require('fflate');
const sharp = require('sharp');
const config = require('./config');

const MAX_DOWNLOAD = 100 * 1024 * 1024;
const THUMB_PX = 128;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const unescapeXml = (s) =>
  s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
    const named = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[e.toLowerCase()];
    if (named) return named;
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];

// "../media/image1.png" relative to "xl/drawings/drawing3.xml" -> "xl/media/image1.png"
const resolve = (fromFile, target) =>
  target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), target));
const relsFor = (file) => path.posix.join(path.posix.dirname(file), '_rels', path.posix.basename(file) + '.rels');

function readRels(files, file) {
  const xml = files[relsFor(file)];
  if (!xml) return {};
  const out = {};
  for (const tag of strFromU8(xml).match(/<Relationship\b[^>]*>/g) || []) {
    out[attr(tag, 'Id')] = resolve(file, attr(tag, 'Target'));
  }
  return out;
}

const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// Text of each cell in the sheet's first row, by column index.
function headerRow(files, sheetFile) {
  const strings = [];
  const sst = files['xl/sharedStrings.xml'];
  if (sst) {
    for (const si of strFromU8(sst).match(/<si>[\s\S]*?<\/si>/g) || []) {
      strings.push(unescapeXml((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
    }
  }
  const xml = strFromU8(files[sheetFile]);
  const row1 = (xml.match(/<row\b[^>]*\br="1"[^>]*>([\s\S]*?)<\/row>/) || [])[1] || '';
  const headers = {};
  for (const c of row1.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
    const ref = attr(c, 'r');
    const type = attr(c, 't');
    const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
    let text = '';
    if (type === 's' && v !== undefined) text = strings[+v] || '';
    else if (type === 'inlineStr') text = unescapeXml((c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
    else if (v !== undefined) text = unescapeXml(v);
    if (ref && text.trim()) headers[colIndex(ref)] = text.trim();
  }
  return headers;
}

// [{ name, image: Buffer }] for every picture under a header on the Images tab.
function extractTeamImages(xlsx, tabName = config.imagesSheet) {
  const files = unzipSync(new Uint8Array(xlsx));
  const workbook = strFromU8(files['xl/workbook.xml'] || new Uint8Array());
  const sheetTag = (workbook.match(/<sheet\b[^>]*>/g) || []).find((t) => norm(unescapeXml(attr(t, 'name') || '')) === norm(tabName));
  if (!sheetTag) return null;
  const sheetFile = readRels(files, 'xl/workbook.xml')[attr(sheetTag, 'r:id')];
  if (!sheetFile || !files[sheetFile]) return null;

  const headers = headerRow(files, sheetFile);
  const drawingId = attr((strFromU8(files[sheetFile]).match(/<drawing\b[^>]*>/) || [''])[0], 'r:id');
  const drawingFile = readRels(files, sheetFile)[drawingId];
  if (!drawingFile || !files[drawingFile]) return [];
  const media = readRels(files, drawingFile);

  // Pictures are anchored by their top-left cell; keep the topmost one under each header.
  const found = {};
  const drawing = strFromU8(files[drawingFile]);
  for (const anchor of drawing.match(/<xdr:(?:oneCell|twoCell)Anchor\b[\s\S]*?<\/xdr:(?:oneCell|twoCell)Anchor>/g) || []) {
    const from = (anchor.match(/<xdr:from>([\s\S]*?)<\/xdr:from>/) || [])[1] || '';
    const col = +((from.match(/<xdr:col>(\d+)<\/xdr:col>/) || [])[1] ?? -1);
    const row = +((from.match(/<xdr:row>(\d+)<\/xdr:row>/) || [])[1] ?? -1);
    const embed = attr((anchor.match(/<a:blip\b[^>]*>/) || [''])[0], 'r:embed');
    const file = media[embed];
    if (row < 1 || !headers[col] || !file || !files[file]) continue;
    if (!found[col] || row < found[col].row) found[col] = { row, name: headers[col], image: Buffer.from(files[file]) };
  }
  return Object.values(found).map(({ name, image }) => ({ name, image }));
}

async function fetchWorkbook() {
  const res = await fetch(config.workbookXlsxUrl, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Workbook download failed: HTTP ${res.status}`);
  const size = +res.headers.get('content-length') || 0;
  if (size > MAX_DOWNLOAD) throw new Error(`Workbook is too large to read pictures from (${Math.round(size / 1e6)} MB)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 2).toString() !== 'PK') throw new Error('Workbook download was not an .xlsx file - check the sheet is shared publicly');
  return buf;
}

// Saves a small square copy of each team's picture in dir and returns
// { [normalised team name]: { file, name } }. Files are named by a hash of the
// original, so unchanged pictures aren't redone and browsers can cache them.
async function saveThumbnails(pictures, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = {};
  for (const { name, image } of pictures) {
    const hash = crypto.createHash('sha1').update(image).digest('hex').slice(0, 16);
    const file = `${hash}.webp`;
    const target = path.join(dir, file);
    if (!fs.existsSync(target)) {
      try {
        await sharp(image).rotate().resize(THUMB_PX, THUMB_PX, { fit: 'cover' }).webp({ quality: 82 }).toFile(target);
      } catch (err) {
        console.warn(`Couldn't read the picture for ${name}: ${err.message}`);
        continue;
      }
    }
    out[norm(name)] = { file, name };
  }
  // Remove pictures that are no longer used.
  const keep = new Set(Object.values(out).map((v) => v.file));
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.webp') && !keep.has(f)) fs.rmSync(path.join(dir, f), { force: true });
  return out;
}

module.exports = { extractTeamImages, fetchWorkbook, saveThumbnails, normName: norm };
