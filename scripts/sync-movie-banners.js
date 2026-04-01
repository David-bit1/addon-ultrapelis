const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'ultrapelis.db');
const MOVIES_DIR = path.join(ROOT, 'peliculas');

function runQuery(sql) {
  const exec = spawnSync('sqlite3', ['-json', DB_FILE, sql], { encoding: 'utf8' });
  if (exec.status !== 0) {
    throw new Error(exec.stderr || exec.stdout || 'SQLite error');
  }
  const out = (exec.stdout || '').trim();
  return out ? JSON.parse(out) : [];
}

function escapeAttr(value) {
  return String(value || '').replace(/&/g, '&amp;');
}

function listHtmlFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        out.push(full);
      }
    }
  }
  return out;
}

function getSlugFromHtml(html, filePath) {
  const bodyMatch = html.match(/<body[^>]*data-movie-id="([^"]+)"/i);
  if (bodyMatch && bodyMatch[1]) return bodyMatch[1].trim();
  return path.basename(filePath).replace(/\.html$/i, '');
}

function updateHeroStyle(html, bannerUrl, posterUrl) {
  const heroRegex = /(class="hero-movie hero"[^>]*style="--movie-bg:\s*)([^"]*)("[^>]*>)/i;
  const match = html.match(heroRegex);
  if (!match) return { html, changed: false };

  const current = match[2] || '';
  let currentBanner = '';
  let currentPoster = '';
  const twoUrl = current.match(/url\('([^']*)'\)\s*,\s*url\('([^']*)'\)/i);
  const oneUrl = current.match(/url\('([^']*)'\)/i);
  if (twoUrl) {
    currentBanner = twoUrl[1] || '';
    currentPoster = twoUrl[2] || '';
  } else if (oneUrl) {
    currentBanner = oneUrl[1] || '';
  }

  const nextBanner = bannerUrl ? escapeAttr(bannerUrl) : currentBanner;
  const nextPoster = posterUrl ? escapeAttr(posterUrl) : currentPoster || currentBanner;
  if (!nextBanner || !nextPoster) return { html, changed: false };

  const nextStyle = `url('${nextBanner}'), url('${nextPoster}');`;
  const nextHtml = html.replace(heroRegex, `$1${nextStyle}$3`);
  return { html: nextHtml, changed: nextHtml !== html };
}

function main() {
  if (!fs.existsSync(DB_FILE)) {
    console.error('DB not found:', DB_FILE);
    process.exit(1);
  }
  const rows = runQuery('SELECT slug, banner_url, poster_url FROM peliculas;');
  const bySlug = new Map(rows.map((row) => [String(row.slug || '').trim(), row]));

  const files = listHtmlFiles(MOVIES_DIR);
  let updated = 0;

  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    const slug = getSlugFromHtml(html, file);
    const row = bySlug.get(slug);
    if (!row) continue;
    const bannerUrl = String(row.banner_url || '').trim();
    const posterUrl = String(row.poster_url || '').trim();
    if (!bannerUrl && !posterUrl) continue;
    const result = updateHeroStyle(html, bannerUrl, posterUrl);
    if (result.changed) {
      fs.writeFileSync(file, result.html, 'utf8');
      updated += 1;
    }
  }

  console.log(`Synced banners for ${updated} movie pages.`);
}

main();
