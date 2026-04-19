const fs = require('fs');
const path = require('path');
const {
  buildVideoInfos,
  buildVideoJsonLds,
  injectVideoJsonLd,
} = require('../server');

const ROOT = path.join(__dirname, '..');
const MOVIES_DIR = path.join(ROOT, 'peliculas');
const SERIES_DIR = path.join(ROOT, 'series');
const BASE_URL = String(process.env.PUBLIC_BASE_URL || 'https://ultrapelis.netlify.app').replace(/\/+$/, '');

function walkHtmlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

function processFile(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const infos = buildVideoInfos(filePath, html, BASE_URL);
  if (!infos.length) return false;
  const jsonLd = buildVideoJsonLds(infos);
  const updated = injectVideoJsonLd(html, jsonLd);
  if (updated === html) return false;
  fs.writeFileSync(filePath, updated, 'utf8');
  return true;
}

const movieFiles = walkHtmlFiles(MOVIES_DIR);
const seriesFiles = walkHtmlFiles(SERIES_DIR);
const files = [...movieFiles, ...seriesFiles];

let updatedCount = 0;
for (const filePath of files) {
  if (processFile(filePath)) updatedCount += 1;
}

console.log(`JSON-LD agregado/actualizado en ${updatedCount} archivos.`);
