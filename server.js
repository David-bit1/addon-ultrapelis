const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);

const ROOT = __dirname;
const ENV_FILE = path.join(ROOT, '.env');
const SQL_FILE = path.join(ROOT, 'sql', 'peliculas.sql');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'ultrapelis.db');
const SERIES_FILE = path.join(DATA_DIR, 'series.json');
const DOOD_SYNC_FILE = path.join(ROOT, 'doodstream-sync.json');
const VEO_SYNC_FILE = path.join(ROOT, 'veo-sync.json');
const TMDB_SYNC_FILE = path.join(ROOT, 'tmdb-sync.json');
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const MOVIES_DIR = path.join(ROOT, 'peliculas');
const SERIES_DIR = path.join(ROOT, 'series');
const SITEMAP_FILE = path.join(ROOT, 'sitemap.xml');
const SITEMAP_VIDEO_FILE = path.join(ROOT, 'sitemap-video.xml');
const SITE_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://ultrapelis.netlify.app').replace(/\/+$/, '');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || '').trim();
const USE_SUPABASE_VIEWS = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const SYNC_COOLDOWN_MS = 1500;
const ADDON_ID = 'com.ultrapelis.stremio';
const ADDON_NAME = 'Ultrapelis';
const ADDON_CATALOG_ID = 'ultrapelis';
const ADDON_ID_PREFIX = 'ultrapelis:';
const SERIES_ID_PREFIX = 'ultrapelis:series:';
const EXCLUDED_MOVIE_SLUGS = new Set([]);
let lastSyncAt = 0;
let lastSyncCheckAt = 0;
let lastFingerprint = '';
let lastSeriesFingerprint = '';
let lastSitemapFingerprint = '';
let moviesCache = [];
let movieBySlugCache = new Map();
let movieByCategorySlugCache = new Map();
let renderedIndexCache = '';

let db;

let seriesCache = [];
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(ENV_FILE);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

function extractServerSources(html) {
  const out = [];
  const regex = /<button([^>]*class=["'][^"']*server-btn[^"']*["'][^>]*)data-src=["']([^"']*)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const attrs = match[1] || '';
    const src = (match[2] || '').trim();
    if (!src) continue;
    if (/data-trailer/i.test(attrs)) continue;
    out.push(src);
  }
  return out;
}

function runExec(sql) {
  try {
    db.exec(sql);
  } catch (error) {
    const snippet = sql.slice(0, 150);
    console.error('Error detallado en SQL:', error.message, '\nComando:', snippet);
    throw new Error(`[SQLite Error] ${error.message} en: ${snippet}`);
  }
}

function ensureDatabase() {
  if (!fs.existsSync(SQL_FILE)) {
    throw new Error(`No existe el archivo SQL base: ${SQL_FILE}`);
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const dbExists = fs.existsSync(DB_FILE) && fs.statSync(DB_FILE).size > 0;
  const needsBootstrap = !dbExists || process.env.RESET_DB === '1';

  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');

  if (!needsBootstrap) {
    ensureOptionalColumns();
    ensureAnalyticsTables();
    return;
  }

  const sqlText = fs.readFileSync(SQL_FILE, 'utf8');
  db.exec(sqlText);
  ensureOptionalColumns();
  ensureAnalyticsTables();
}

function ensureOptionalColumns() {
  const cols = runQuery('PRAGMA table_info(peliculas);');
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('veo_embed_url')) {
    runExec('ALTER TABLE peliculas ADD COLUMN veo_embed_url TEXT;');
  }
  if (!names.has('extra_embed_url')) {
    runExec('ALTER TABLE peliculas ADD COLUMN extra_embed_url TEXT;');
  }
  if (!names.has('banner_url')) {
    runExec('ALTER TABLE peliculas ADD COLUMN banner_url TEXT;');
  }
}

function ensureAnalyticsTables() {
  runExec(`
    CREATE TABLE IF NOT EXISTS pelicula_popularidad (
      pelicula_id INTEGER PRIMARY KEY,
      vistas INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (pelicula_id) REFERENCES peliculas(id) ON DELETE CASCADE
    );
  `);
}

function runQuery(sql) {
  try {
    return db.prepare(sql).all();
  } catch (error) {
    throw new Error(`Error consultando SQLite: ${error.message}`);
  }
}

function walkMovieHtmlFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;

  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkMovieHtmlFiles(full));
      continue;
    }
    if (name.endsWith('.html')) out.push(full);
  }

  return out.sort((a, b) => a.localeCompare(b));
}

function walkHtmlFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;

  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkHtmlFiles(full));
      continue;
    }
    if (name.endsWith('.html')) out.push(full);
  }

  return out.sort((a, b) => a.localeCompare(b));
}

function isNoIndexHtml(filePath) {
  let text = '';
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return false;
  }
  const lower = text.toLowerCase();
  if (!lower.includes('name="robots"') && !lower.includes("name='robots'")) return false;
  return lower.includes('noindex');
}

function collectSitemapHtmlFiles() {
  const rootHtml = fs
    .readdirSync(ROOT)
    .filter((name) => name.endsWith('.html'))
    .map((name) => path.join(ROOT, name));
  const movieHtml = walkHtmlFiles(MOVIES_DIR);
  const seriesHtml = walkHtmlFiles(SERIES_DIR);
  return [...rootHtml, ...movieHtml, ...seriesHtml];
}

function computeSitemapFingerprint(files) {
  return files
    .map((filePath) => {
      const stat = fs.statSync(filePath);
      const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
      return `${rel}:${stat.mtimeMs}:${stat.size}`;
    })
    .join('|');
}

function buildSitemapEntries(baseUrl = SITE_BASE_URL, files = null) {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  const htmlFiles = files || collectSitemapHtmlFiles();
  const entries = [];

  for (const filePath of htmlFiles) {
    if (isNoIndexHtml(filePath)) continue;
    const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
    let urlPath = getUrlPathFromRel(rel);
    urlPath = urlPath.replace(/\/{2,}/g, '/');
    const loc = normalizedBase ? `${normalizedBase}${urlPath}` : urlPath;
    let lastmod = '';
    try {
      const stat = fs.statSync(filePath);
      lastmod = new Date(stat.mtimeMs).toISOString();
    } catch (_) {
      lastmod = '';
    }
    entries.push({ loc, lastmod, filePath });
  }

  return entries.sort((a, b) => a.loc.localeCompare(b.loc));
}

function buildSitemapXml(baseUrl = SITE_BASE_URL, files = null) {
  const entries = buildSitemapEntries(baseUrl, files);
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">'
  );
  for (const entry of entries) {
    let videoXml = '';
    try {
      const html = fs.readFileSync(entry.filePath, 'utf8');
      const infos = buildVideoInfos(entry.filePath, html, baseUrl);
      if (infos.length) {
        videoXml = infos.map(renderVideoXml).filter(Boolean).join('\n');
      }
    } catch (_) {
      videoXml = '';
    }
    if (entry.lastmod) {
      lines.push(`  <url>`);
      lines.push(`    <loc>${entry.loc}</loc>`);
      lines.push(`    <lastmod>${entry.lastmod}</lastmod>`);
      if (videoXml) lines.push(videoXml);
      lines.push(`  </url>`);
    } else {
      lines.push(`  <url>`);
      lines.push(`    <loc>${entry.loc}</loc>`);
      if (videoXml) lines.push(videoXml);
      lines.push(`  </url>`);
    }
  }
  lines.push('</urlset>');
  return { xml: `${lines.join('\n')}\n`, count: entries.length };
}

function buildVideoSitemapXml(baseUrl = SITE_BASE_URL, files = null) {
  const entries = buildSitemapEntries(baseUrl, files);
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">'
  );
  let count = 0;

  for (const entry of entries) {
    let videoXml = '';
    try {
      const html = fs.readFileSync(entry.filePath, 'utf8');
      const infos = buildVideoInfos(entry.filePath, html, baseUrl);
      if (infos.length) {
        videoXml = infos.map(renderVideoXml).filter(Boolean).join('\n');
      }
    } catch (_) {
      videoXml = '';
    }

    if (!videoXml) continue;
    count += 1;
    lines.push(`  <url>`);
    lines.push(`    <loc>${entry.loc}</loc>`);
    if (entry.lastmod) lines.push(`    <lastmod>${entry.lastmod}</lastmod>`);
    lines.push(videoXml);
    lines.push(`  </url>`);
  }

  lines.push('</urlset>');
  return { xml: `${lines.join('\n')}\n`, count };
}

function writeSitemapXml(baseUrl = SITE_BASE_URL) {
  const { xml, count } = buildSitemapXml(baseUrl);
  fs.writeFileSync(SITEMAP_FILE, xml, 'utf8');
  return { count, file: SITEMAP_FILE };
}

function writeVideoSitemapXml(baseUrl = SITE_BASE_URL) {
  const { xml, count } = buildVideoSitemapXml(baseUrl);
  fs.writeFileSync(SITEMAP_VIDEO_FILE, xml, 'utf8');
  return { count, file: SITEMAP_VIDEO_FILE };
}

function maybeWriteSitemap(baseUrl = SITE_BASE_URL) {
  const files = collectSitemapHtmlFiles();
  const fingerprint = computeSitemapFingerprint(files);
  if (fingerprint === lastSitemapFingerprint) return false;
  const { xml } = buildSitemapXml(baseUrl, files);
  fs.writeFileSync(SITEMAP_FILE, xml, 'utf8');
  const { xml: videoXml } = buildVideoSitemapXml(baseUrl, files);
  fs.writeFileSync(SITEMAP_VIDEO_FILE, videoXml, 'utf8');
  lastSitemapFingerprint = fingerprint;
  return true;
}

function computeMoviesFingerprint(files) {
  return files
    .map((filePath) => {
      const stat = fs.statSync(filePath);
      const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
      return `${rel}:${stat.mtimeMs}:${stat.size}`;
    })
    .join('|');
}

function toCategoryName(slug) {
  return slug
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number.parseInt(n, 10)));
}

function normalizeText(text) {
  return decodeHtmlEntities(String(text || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function regexEscape(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchFirst(html, pattern) {
  const found = html.match(pattern);
  return found ? normalizeText(found[1]) : '';
}

function extractInfoField(html, label) {
  const safeLabel = regexEscape(label);
  const pattern = new RegExp(`<h3>\\s*${safeLabel}\\s*</h3>\\s*<p>\\s*([\\s\\S]*?)\\s*</p>`, 'i');
  return matchFirst(html, pattern);
}

function normalizeAssetUrl(rawUrl, filePath) {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const cutIndex =
    hashIndex === -1 ? queryIndex : queryIndex === -1 ? hashIndex : Math.min(hashIndex, queryIndex);
  const suffix = cutIndex === -1 ? '' : url.slice(cutIndex);
  const base = cutIndex === -1 ? url : url.slice(0, cutIndex);

  if (/^https?:\/\//i.test(base) || base.startsWith('/')) return `${base}${suffix}`;
  const abs = path.resolve(path.dirname(filePath), base);
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return `${base}${suffix}`;
  return `/${rel}${suffix}`;
}

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncateText(text, max) {
  const value = String(text || '').trim();
  if (!max || value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function parseDurationToSeconds(text) {
  const value = String(text || '').toLowerCase();
  const hoursMatch = value.match(/(\d+)\s*h/);
  const minsMatch = value.match(/(\d+)\s*m/);
  const hours = hoursMatch ? Number.parseInt(hoursMatch[1], 10) : 0;
  const mins = minsMatch ? Number.parseInt(minsMatch[1], 10) : 0;
  const total = hours * 3600 + mins * 60;
  return total > 0 ? total : 0;
}

function parseDurationToIso(text) {
  const value = String(text || '').toLowerCase();
  const hoursMatch = value.match(/(\d+)\s*h/);
  const minsMatch = value.match(/(\d+)\s*m/);
  const hours = hoursMatch ? Number.parseInt(hoursMatch[1], 10) : 0;
  const mins = minsMatch ? Number.parseInt(minsMatch[1], 10) : 0;
  if (!hours && !mins) return '';
  return `PT${hours ? `${hours}H` : ''}${mins ? `${mins}M` : ''}`;
}

function getUrlPathFromRel(rel) {
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.replace(/\/index\.html$/, '/')}`;
  return `/${rel}`;
}

function renderVideoXml(info) {
  if (!info) return '';
  const description = truncateText(info.description, 2048) || info.title;
  const isDirect = /\.(m3u8|mp4|webm)(\?|#|$)/i.test(info.embedUrl);
  const duration = info.durationSeconds || 0;
  return [
    '    <video:video>',
    `      <video:thumbnail_loc>${escapeXml(info.thumbnail)}</video:thumbnail_loc>`,
    `      <video:title>${escapeXml(info.title)}</video:title>`,
    `      <video:description>${escapeXml(description)}</video:description>`,
    isDirect
      ? `      <video:content_loc>${escapeXml(info.embedUrl)}</video:content_loc>`
      : `      <video:player_loc allow_embed="yes">${escapeXml(info.embedUrl)}</video:player_loc>`,
    info.publicationDate
      ? `      <video:publication_date>${escapeXml(info.publicationDate)}</video:publication_date>`
      : '',
    duration ? `      <video:duration>${duration}</video:duration>` : '',
    '    </video:video>',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildVideoInfos(filePath, html, baseUrl) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const isMovie = rel.startsWith('peliculas/');
  const isSeries = rel.startsWith('series/');
  if (!isMovie && !isSeries) return [];

  const data = isMovie ? parseMovieHtml(filePath, html) : parseSeriesHtml(filePath, html);
  const titleBase = data.titulo || data.slug || 'Video';
  const description = data.sinopsis || data.descripcion || titleBase;
  const thumbnail = toAbsoluteUrl(baseUrl, data.posterUrl || data.bannerUrl || '');

  let publicationDate = '';
  try {
    const stat = fs.statSync(filePath);
    publicationDate = new Date(stat.mtimeMs).toISOString();
  } catch (_) {
    publicationDate = '';
  }

  const relPath = getUrlPathFromRel(rel);
  const pageUrl = toAbsoluteUrl(baseUrl, relPath);

  if (isMovie) {
    const embedUrl = String(data.embedUrl || '').trim();
    if (!embedUrl || !thumbnail) return [];
    return [
      {
        title: titleBase,
        description,
        thumbnail,
        embedUrl,
        durationIso: parseDurationToIso(data.duracion),
        durationSeconds: parseDurationToSeconds(data.duracion),
        publicationDate,
        pageUrl,
      },
    ];
  }

  const seriesDataMatch = html.match(
    /<script[^>]*id=["']series-data["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!seriesDataMatch || !thumbnail) return [];
  let payload;
  try {
    payload = JSON.parse(seriesDataMatch[1]);
  } catch (_) {
    return [];
  }
  const seasons = Array.isArray(payload?.seasons) ? payload.seasons : [];
  const out = [];
  seasons.forEach((season) => {
    const seasonNumber = String(season?.number || '').trim();
    const episodes = Array.isArray(season?.episodes) ? season.episodes : [];
    episodes.forEach((episode) => {
      const sources = Array.isArray(episode?.sources) ? episode.sources : [];
      const first = sources.find((item) => item && item.src) || null;
      if (!first) return;
      const episodeNumber = String(episode?.number || '').trim();
      const episodeTitle = String(episode?.title || '').trim();
      const seasonTag = seasonNumber ? `T${seasonNumber}` : '';
      const episodeTag = episodeNumber ? `E${episodeNumber}` : '';
      const tag = `${seasonTag}${episodeTag}`.trim();
      const fullTitle = `${titleBase}${tag ? ` - ${tag}` : ''}${episodeTitle ? ` ${episodeTitle}` : ''}`;
      out.push({
        title: fullTitle,
        description,
        thumbnail,
        embedUrl: String(first.src || '').trim(),
        durationIso: '',
        durationSeconds: 0,
        publicationDate,
        pageUrl,
      });
    });
  });
  return out;
}

function buildVideoInfo(filePath, html, baseUrl) {
  const infos = buildVideoInfos(filePath, html, baseUrl);
  return infos.length ? infos[0] : null;
}

function buildVideoInfoFromMovie(movie, baseUrl) {
  if (!movie) return null;
  const embedUrl = String(movie.embed_url || movie.veo_embed_url || '').trim();
  if (!embedUrl) return null;
  const title = String(movie.titulo || movie.slug || 'Video').trim();
  const description = String(movie.sinopsis || movie.descripcion || title).trim();
  const thumbnail = toAbsoluteUrl(baseUrl, movie.poster_url || '');
  const durationIso = parseDurationToIso(movie.duracion);
  const durationSeconds = parseDurationToSeconds(movie.duracion);
  const pageUrl = getMoviePageUrl(movie, baseUrl);
  const publicationDate = new Date().toISOString();
  return {
    title,
    description,
    thumbnail,
    embedUrl,
    durationIso,
    durationSeconds,
    publicationDate,
    pageUrl,
  };
}

function buildVideoJsonLd(info) {
  if (!info) return '';
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: info.title,
    description: info.description,
    thumbnailUrl: [info.thumbnail],
    uploadDate: info.publicationDate || undefined,
    duration: info.durationIso || undefined,
    embedUrl: info.embedUrl,
    url: info.pageUrl,
  };
  Object.keys(payload).forEach((key) => {
    if (payload[key] == null || payload[key] === '') delete payload[key];
  });
  return JSON.stringify(payload);
}

function buildVideoJsonLds(infos) {
  if (!Array.isArray(infos) || !infos.length) return [];
  return infos.map((info) => buildVideoJsonLd(info)).filter(Boolean);
}

function injectVideoJsonLd(html, jsonLd) {
  if (!jsonLd || (Array.isArray(jsonLd) && !jsonLd.length)) return html;
  if (html.includes('application/ld+json') && html.includes('VideoObject')) return html;
  const headClose = html.indexOf('</head>');
  if (headClose === -1) return html;
  const payloads = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
  const script = payloads
    .map((payload) => `<script type="application/ld+json">${payload}</script>`)
    .join('');
  return `${html.slice(0, headClose)}  ${script}\n${html.slice(headClose)}`;
}

function parseMovieHtml(filePath, html) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const parts = rel.split('/');
  const categoriaSlug = parts[1] || '';
  const slug = path.basename(filePath, '.html');

  // Extrae el título de la etiqueta <h1> o <title>.
  const titulo =
    matchFirst(html, /<h1[^>]*id=["']movie-title["'][^>]*>\s*([\s\S]*?)\s*<\/h1>/i) ||
    matchFirst(html, /<title>\s*([\s\S]*?)\s*\|\s*Ultrapelis\s*<\/title>/i) ||
    slug;

  // Extrae la descripción de las metaetiquetas.
  const descripcion =
    matchFirst(html, /<meta\s+[^>]*?name=["']description["'][^>]*?content=["']([^"']+)["']/i) ||
    matchFirst(html, /<meta\s+[^>]*?content=["']([^"']+)["'][^>]*?name=["']description["']/i);

  const bannerMeta =
    matchFirst(html, /<meta\s+[^>]*?name=["']banner["'][^>]*?content=["']([^"']+)["']/i) ||
    matchFirst(html, /<meta\s+[^>]*?content=["']([^"']+)["'][^>]*?name=["']banner["']/i);

  // Extrae la URL del banner y del póster desde el estilo de fondo o metaetiquetas.
  const bgMatch = html.match(/--movie-bg:\s*url\(\s*['"]?([^'"]+?)['"]?\s*\)(?:\s*,\s*url\(\s*['"]?([^'"]+?)['"]?\s*\))?/i);
  const bannerUrl = bgMatch ? normalizeText(bgMatch[1]) : '';
  const posterUrlFromBg = bgMatch ? normalizeText(bgMatch[2] || bgMatch[1]) : '';
  const posterMeta =
    matchFirst(html, /<meta\s+[^>]*?property=["']og:image["'][^>]*?content=["']([^"']+)["']/i) ||
    matchFirst(html, /<meta\s+[^>]*?content=["']([^"']+)["'][^>]*?property=["']og:image["']/i) ||
    matchFirst(html, /<meta\s+[^>]*?name=["']twitter:image["'][^>]*?content=["']([^"']+)["']/i) ||
    matchFirst(html, /<meta\s+[^>]*?content=["']([^"']+)["'][^>]*?name=["']twitter:image["']/i);

  const normalizedPoster = normalizeAssetUrl(posterMeta || posterUrlFromBg, filePath);
  const normalizedBanner = normalizeAssetUrl(bannerMeta || bannerUrl || posterUrlFromBg, filePath);

  // Devuelve un objeto con toda la información extraída.
  return {
    titulo,
    slug,
    categoriaSlug,
    rutaHtml: rel,
    descripcion,
    sinopsis: matchFirst(html, /<p[^>]*class=["']synopsis["'][^>]*>\s*([\s\S]*?)\s*<\/p>/i),
    director: extractInfoField(html, 'Director'),
    reparto: extractInfoField(html, 'Reparto principal'),
    estrenoTexto: extractInfoField(html, 'Estreno'),
    duracion: extractInfoField(html, 'Duracion'),
    idioma: extractInfoField(html, 'Idiomas'),
    calificacion: extractInfoField(html, 'Calificacion'),
    posterUrl: normalizedPoster,
    bannerUrl: normalizedBanner,
    ...(() => {
      const sources = extractServerSources(html);
      return {
        embedUrl: sources[0] || '',
        veoEmbedUrl: sources[1] || '',
        extraEmbedUrl: sources[2] || '',
      };
    })(),
  };
}

function parseMovieFile(filePath) {
  // Lee el contenido del archivo HTML de la película.
  const html = fs.readFileSync(filePath, 'utf8');
  return parseMovieHtml(filePath, html);
}

function parseSeriesHtml(filePath, html) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const slug = path.basename(filePath, '.html');

  const titulo =
    matchFirst(html, /<h1[^>]*id=["']series-title["'][^>]*>\s*([\s\S]*?)\s*<\/h1>/i) ||
    matchFirst(html, /<title>\s*([\s\S]*?)\s*\|\s*Ultrapelis\s*<\/title>/i) ||
    slug;

  const descripcion =
    matchFirst(html, /<meta\s+[^>]*?name=["']description["'][^>]*?content=["']([^"']+)["']/i) ||
    matchFirst(html, /<meta\s+[^>]*?content=["']([^"']+)["'][^>]*?name=["']description["']/i);

  const bannerMeta =
    matchFirst(html, /<meta\s+[^>]*?name=["']banner["'][^>]*?content=["']([^"']+)["']/i) ||
    matchFirst(html, /<meta\s+[^>]*?content=["']([^"']+)["'][^>]*?name=["']banner["']/i);

  const bgMatch = html.match(/--movie-bg:\s*url\(\s*['"]?([^'"]+?)['"]?\s*\)(?:\s*,\s*url\(\s*['"]?([^'"]+?)['"]?\s*\))?/i);
  const bannerUrl = bgMatch ? normalizeText(bgMatch[1]) : '';
  const posterUrlFromBg = bgMatch ? normalizeText(bgMatch[2] || bgMatch[1]) : '';
  const posterMeta =
    matchFirst(html, /<meta\s+[^>]*?property=["']og:image["'][^>]*?content=["']([^"']+)["']/i) ||
    matchFirst(html, /<meta\s+[^>]*?content=["']([^"']+)["'][^>]*?property=["']og:image["']/i) ||
    matchFirst(html, /<meta\s+[^>]*?name=["']twitter:image["'][^>]*?content=["']([^"']+)["']/i) ||
    matchFirst(html, /<meta\s+[^>]*?content=["']([^"']+)["'][^>]*?name=["']twitter:image["']/i);

  const normalizedPoster = normalizeAssetUrl(posterMeta || posterUrlFromBg, filePath);
  const normalizedBanner = normalizeAssetUrl(bannerMeta || bannerUrl || posterUrlFromBg, filePath);

  let embedUrl = '';
  let episodeTitle = '';
  let episodeNumber = '';
  let seasonNumber = '';
  const seriesDataMatch = html.match(
    /<script[^>]*id=["']series-data["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (seriesDataMatch) {
    try {
      const data = JSON.parse(seriesDataMatch[1]);
      const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
      for (const season of seasons) {
        const episodes = Array.isArray(season?.episodes) ? season.episodes : [];
        for (const episode of episodes) {
          const sources = Array.isArray(episode?.sources) ? episode.sources : [];
          const source = sources.find((item) => item && item.src) || null;
          if (source) {
            embedUrl = String(source.src || '').trim();
            episodeTitle = String(episode?.title || '').trim();
            episodeNumber = String(episode?.number || '').trim();
            seasonNumber = String(season?.number || '').trim();
            break;
          }
        }
        if (embedUrl) break;
      }
    } catch (_) {
      embedUrl = '';
    }
  }

  return {
    titulo,
    slug,
    rutaHtml: rel,
    descripcion,
    sinopsis: matchFirst(html, /<p[^>]*class=["']synopsis["'][^>]*>\s*([\s\S]*?)\s*<\/p>/i),
    posterUrl: normalizedPoster,
    bannerUrl: normalizedBanner,
    embedUrl,
    episodeTitle,
    episodeNumber,
    seasonNumber,
  };
}

function parseSeriesFile(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  return parseSeriesHtml(filePath, html);
}

function sqlValue(value) {
  if (value == null) return 'NULL';
  const text = String(value).trim();
  if (!text) return 'NULL';
  return `'${escapeSql(text)}'`;
}

function buildDoodEmbedUrl(fileCode) {
  return `https://doodstream.com/e/${fileCode}`;
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeFileCode(value) {
  const code = String(value || '').trim();
  return /^[a-z0-9]+$/i.test(code) ? code : '';
}

function isDirectMediaUrl(url) {
  return /\.(m3u8|mp4|webm)(\?|#|$)/i.test(String(url || '').trim());
}

function normalizeTmdbId(value) {
  const id = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

function readDoodSyncMap() {
  if (!fs.existsSync(DOOD_SYNC_FILE)) return {};
  const raw = fs.readFileSync(DOOD_SYNC_FILE, 'utf8').trim();
  if (!raw) return {};

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`JSON invalido en ${path.basename(DOOD_SYNC_FILE)}: ${error.message}`);
  }

  const out = {};
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const slug = normalizeSlug(item.slug);
      const fileCode = normalizeFileCode(item.file_code || item.fileCode);
      if (slug && fileCode) out[slug] = fileCode;
    }
    return out;
  }

  const source = parsed && typeof parsed === 'object' && parsed.mappings && typeof parsed.mappings === 'object'
    ? parsed.mappings
    : parsed;

  if (!source || typeof source !== 'object') return {};
  for (const [slugRaw, fileCodeRaw] of Object.entries(source)) {
    const slug = normalizeSlug(slugRaw);
    const fileCode = normalizeFileCode(fileCodeRaw);
    if (slug && fileCode) out[slug] = fileCode;
  }
  return out;
}

function readVeoSyncMap() {
  if (!fs.existsSync(VEO_SYNC_FILE)) return {};
  const raw = fs.readFileSync(VEO_SYNC_FILE, 'utf8').trim();
  if (!raw) return {};

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`JSON invalido en ${path.basename(VEO_SYNC_FILE)}: ${error.message}`);
  }

  const out = {};
  const source =
    parsed && typeof parsed === 'object' && parsed.mappings && typeof parsed.mappings === 'object'
      ? parsed.mappings
      : parsed;

  if (!source || typeof source !== 'object') return {};
  for (const [slugRaw, urlRaw] of Object.entries(source)) {
    const slug = normalizeSlug(slugRaw);
    const url = String(urlRaw || '').trim();
    if (slug && /^https?:\/\//i.test(url)) out[slug] = url;
  }
  return out;
}

function readTmdbSyncMap() {
  if (!fs.existsSync(TMDB_SYNC_FILE)) return {};
  const raw = fs.readFileSync(TMDB_SYNC_FILE, 'utf8').trim();
  if (!raw) return {};

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`JSON invalido en ${path.basename(TMDB_SYNC_FILE)}: ${error.message}`);
  }

  const out = {};
  const source =
    parsed && typeof parsed === 'object' && parsed.mappings && typeof parsed.mappings === 'object'
      ? parsed.mappings
      : parsed;

  if (!source || typeof source !== 'object') return {};
  for (const [slugRaw, tmdbIdRaw] of Object.entries(source)) {
    const slug = normalizeSlug(slugRaw);
    const tmdbId = normalizeTmdbId(tmdbIdRaw);
    if (slug && tmdbId) out[slug] = tmdbId;
  }
  return out;
}

function syncDoodstreamEmbeds() {
  const map = readDoodSyncMap();
  const entries = Object.entries(map);
  if (!entries.length) {
    return { updated: 0, missing: [], source: path.basename(DOOD_SYNC_FILE) };
  }

  const missing = [];
  const sqlLines = ['BEGIN TRANSACTION;'];

  for (const [slug, fileCode] of entries) {
    const slugRows = runQuery(`SELECT id FROM peliculas WHERE slug=${sqlValue(slug)} LIMIT 1;`);
    if (!slugRows.length) {
      missing.push(slug);
      continue;
    }
    const embedUrl = buildDoodEmbedUrl(fileCode);
    sqlLines.push(
      `UPDATE peliculas SET embed_url=${sqlValue(embedUrl)} WHERE slug=${sqlValue(slug)};`
    );
  }

  sqlLines.push('COMMIT;');
  runExec(sqlLines.join('\n'));
  refreshCacheFromDatabase();

  return {
    updated: entries.length - missing.length,
    missing,
    source: path.basename(DOOD_SYNC_FILE),
  };
}

function syncVeoEmbeds() {
  const map = readVeoSyncMap();
  const entries = Object.entries(map);
  if (!entries.length) {
    return { updated: 0, missing: [], source: path.basename(VEO_SYNC_FILE) };
  }

  const missing = [];
  const sqlLines = ['BEGIN TRANSACTION;'];

  for (const [slug, veoUrl] of entries) {
    const slugRows = runQuery(`SELECT id FROM peliculas WHERE slug=${sqlValue(slug)} LIMIT 1;`);
    if (!slugRows.length) {
      missing.push(slug);
      continue;
    }
    sqlLines.push(
      `UPDATE peliculas SET veo_embed_url=${sqlValue(veoUrl)} WHERE slug=${sqlValue(slug)};`
    );
  }

  sqlLines.push('COMMIT;');
  runExec(sqlLines.join('\n'));
  refreshCacheFromDatabase();

  return {
    updated: entries.length - missing.length,
    missing,
    source: path.basename(VEO_SYNC_FILE),
  };
}

async function syncTmdbImages() {
  const apiKey = String(process.env.TMDB_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Falta TMDB_API_KEY en variables de entorno.');
  }

  const map = readTmdbSyncMap();
  const entries = Object.entries(map);
  if (!entries.length) {
    return { updated: 0, missing: [], withoutImages: [], source: path.basename(TMDB_SYNC_FILE) };
  }

  const missing = [];
  const withoutImages = [];
  let updated = 0;

  for (const [slug, tmdbId] of entries) {
    const slugRows = runQuery(`SELECT id FROM peliculas WHERE slug=${sqlValue(slug)} LIMIT 1;`);
    if (!slugRows.length) {
      missing.push(slug);
      continue;
    }

    const url = `${TMDB_API_BASE}/movie/${tmdbId}?api_key=${encodeURIComponent(apiKey)}&language=es-MX`;
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      withoutImages.push(slug);
      continue;
    }

    const payload = await response.json();
    const posterPath = payload && payload.poster_path ? String(payload.poster_path) : '';
    const bannerPath = payload && payload.backdrop_path ? String(payload.backdrop_path) : '';
    if (!posterPath && !bannerPath) {
      withoutImages.push(slug);
      continue;
    }

    const posterUrl = posterPath ? `${TMDB_IMAGE_BASE}/w500${posterPath}` : null;
    const bannerUrl = bannerPath ? `${TMDB_IMAGE_BASE}/original${bannerPath}` : null;

    const sqlLines = [];
    if (posterUrl) sqlLines.push(`poster_url=${sqlValue(posterUrl)}`);
    if (bannerUrl) sqlLines.push(`banner_url=${sqlValue(bannerUrl)}`);
    if (!sqlLines.length) {
      withoutImages.push(slug);
      continue;
    }

    runExec(`UPDATE peliculas SET ${sqlLines.join(', ')} WHERE slug=${sqlValue(slug)};`);
    updated += 1;
  }

  refreshCacheFromDatabase();
  return {
    updated,
    missing,
    withoutImages,
    source: path.basename(TMDB_SYNC_FILE),
  };
}

function syncMoviesFromHtml() {
  const files = walkMovieHtmlFiles(MOVIES_DIR);
  const fingerprint = computeMoviesFingerprint(files);
  const movies = files
    .map(parseMovieFile)
    .filter(
      (movie) =>
        movie.categoriaSlug &&
        movie.slug &&
        !EXCLUDED_MOVIE_SLUGS.has(String(movie.slug).trim().toLowerCase())
    );
  const categorySet = new Set(movies.map((movie) => movie.categoriaSlug));
  const sqlLines = ['BEGIN TRANSACTION;'];

  for (const categorySlug of Array.from(categorySet).sort()) {
    const nombre = toCategoryName(categorySlug);
    sqlLines.push(
      `INSERT INTO categorias (nombre, slug) VALUES (${sqlValue(nombre)}, ${sqlValue(categorySlug)}) ` +
        'ON CONFLICT(slug) DO UPDATE SET nombre=excluded.nombre;'
    );
  }

  for (const movie of movies) {
    // Prepara una sentencia INSERT o UPDATE para cada película.
    // Esto asegura que la base de datos esté sincronizada con los archivos HTML.
    sqlLines.push(
      `
      INSERT INTO peliculas (
        categoria_id, titulo, slug, ruta_html, descripcion, sinopsis, 
        director, reparto, estreno_texto, duracion, idioma, 
        calificacion, poster_url, embed_url, veo_embed_url, extra_embed_url
      ) VALUES (
        (SELECT id FROM categorias WHERE slug=${sqlValue(movie.categoriaSlug)}), 
        ${sqlValue(movie.titulo)}, ${sqlValue(movie.slug)}, ${sqlValue(movie.rutaHtml)}, 
        ${sqlValue(movie.descripcion)}, ${sqlValue(movie.sinopsis)}, ${sqlValue(movie.director)}, 
        ${sqlValue(movie.reparto)}, ${sqlValue(movie.estrenoTexto)}, ${sqlValue(movie.duracion)}, 
        ${sqlValue(movie.idioma)}, ${sqlValue(movie.calificacion)}, ${sqlValue(movie.posterUrl)}, 
        ${sqlValue(movie.embedUrl)}, ${sqlValue(movie.veoEmbedUrl)}, ${sqlValue(movie.extraEmbedUrl)}
      ) 
      ON CONFLICT(slug) DO UPDATE SET 
        categoria_id=excluded.categoria_id, 
        titulo=excluded.titulo, 
        ruta_html=excluded.ruta_html, 
        descripcion=excluded.descripcion, 
        sinopsis=excluded.sinopsis, 
        director=excluded.director, 
        reparto=excluded.reparto, 
        estreno_texto=excluded.estreno_texto, 
        duracion=excluded.duracion, 
        idioma=excluded.idioma, 
        calificacion=excluded.calificacion, 
        poster_url=excluded.poster_url, 
        embed_url=excluded.embed_url,
        veo_embed_url=excluded.veo_embed_url,
        extra_embed_url=excluded.extra_embed_url;
      `
    );
    // Actualiza la URL del banner por separado.
    sqlLines.push(
      `UPDATE peliculas SET banner_url=${sqlValue(movie.bannerUrl)} WHERE slug=${sqlValue(movie.slug)};`
    );
  }

  if (movies.length > 0) {
    const keep = movies.map((movie) => sqlValue(movie.rutaHtml)).join(', ');
    // Elimina películas de la base de datos que ya no tienen un archivo HTML correspondiente.
    sqlLines.push(`DELETE FROM peliculas WHERE ruta_html LIKE 'peliculas/%' AND ruta_html NOT IN (${keep});`);
  }

  sqlLines.push('COMMIT;');
  runExec(sqlLines.join('\n'));
  lastSyncAt = Date.now();
  lastFingerprint = fingerprint;
  refreshCacheFromDatabase();
  try {
    maybeWriteSitemap();
  } catch (error) {
    console.warn('No se pudo generar sitemap.xml:', error.message);
  }

  return { movies: movies.length, categories: categorySet.size };
}

function maybeSyncMoviesFromHtml() {
  const now = Date.now();
  if (now - lastSyncCheckAt < SYNC_COOLDOWN_MS) return;
  lastSyncCheckAt = now;
  const files = walkMovieHtmlFiles(MOVIES_DIR);
  const fingerprint = computeMoviesFingerprint(files);
  if (fingerprint === lastFingerprint) return;
  syncMoviesFromHtml();
}

function getAllMovies() {
  return runQuery(`
    SELECT
      p.id,
      p.titulo,
      p.slug,
      p.ruta_html,
      p.descripcion,
      p.sinopsis,
      p.director,
      p.reparto,
      p.estreno_texto,
      p.duracion,
      p.idioma,
      p.calificacion,
      p.poster_url,
      p.banner_url,
      p.embed_url,
      p.veo_embed_url,
      p.extra_embed_url,
      c.nombre AS categoria_nombre,
      c.slug AS categoria_slug
    FROM peliculas p
    INNER JOIN categorias c ON c.id = p.categoria_id
    ORDER BY p.titulo COLLATE NOCASE ASC;
  `);
}

function getMovieByCategoryAndSlug(categorySlug, movieSlug) {
  return movieByCategorySlugCache.get(`${categorySlug}/${movieSlug}`) || null;
}

function getRecentMovies(limit = 20) {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.floor(limit), 1), 50)
    : 20;

  const withTimes = moviesCache.map((movie) => {
    const relPath = String(movie.ruta_html || '');
    const filePath = path.join(ROOT, relPath);
    let mtimeMs = 0;
    try {
      if (relPath && fs.existsSync(filePath)) {
        mtimeMs = fs.statSync(filePath).mtimeMs || 0;
      }
    } catch (_) {
      mtimeMs = 0;
    }
    return { movie, mtimeMs };
  });

  return withTimes
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, safeLimit)
    .map((entry) => ({
      ...entry.movie,
      reciente_mtime_ms: Math.round(entry.mtimeMs),
    }));
}

async function registerMovieViewSupabase(slug) {
  if (!USE_SUPABASE_VIEWS) return null;
  const safeSlug = normalizeSlug(slug);
  if (!safeSlug) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_movie_view`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ slug_input: safeSlug }),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const views = typeof payload === 'number'
      ? payload
      : Number.parseInt(String(payload || '0'), 10);
    return Number.isFinite(views) ? views : null;
  } catch (_) {
    return null;
  }
}

async function registerSeriesViewSupabase(slug) {
  if (!USE_SUPABASE_VIEWS) return null;
  const safeSlug = normalizeSlug(slug);
  if (!safeSlug) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_series_view`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ slug_input: safeSlug }),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const views = typeof payload === 'number'
      ? payload
      : Number.parseInt(String(payload || '0'), 10);
    return Number.isFinite(views) ? views : null;
  } catch (_) {
    return null;
  }
}

async function registerMovieView(slug) {
  const safeSlug = normalizeSlug(slug);
  if (!safeSlug) return null;

  const supabaseViews = await registerMovieViewSupabase(safeSlug);
  if (supabaseViews != null) return supabaseViews;

  const movieRows = runQuery(
    `SELECT id FROM peliculas WHERE slug=${sqlValue(safeSlug)} LIMIT 1;`
  );
  if (!movieRows.length) return null;

  const movieId = Number.parseInt(String(movieRows[0].id || '0'), 10);
  if (!Number.isFinite(movieId) || movieId <= 0) return null;

  runExec(
    `INSERT INTO pelicula_popularidad (pelicula_id, vistas, updated_at)
     VALUES (${movieId}, 1, datetime('now'))
     ON CONFLICT(pelicula_id) DO UPDATE
     SET vistas = pelicula_popularidad.vistas + 1,
         updated_at = datetime('now');`
  );

  const rows = runQuery(
    `SELECT vistas FROM pelicula_popularidad WHERE pelicula_id=${movieId} LIMIT 1;`
  );
  if (!rows.length) return null;
  return Number.parseInt(String(rows[0].vistas || '0'), 10) || 0;
}

async function registerSeriesView(slug) {
  const safeSlug = normalizeSlug(slug);
  if (!safeSlug) return null;
  const views = await registerSeriesViewSupabase(safeSlug);
  return views == null ? null : views;
}

async function fetchSupabaseTopViews(rpcName, limit = 10) {
  if (!USE_SUPABASE_VIEWS) return [];
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.floor(limit), 1), 50)
    : 10;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit_input: safeLimit }),
    });
    if (!res.ok) return [];
    const payload = await res.json();
    return Array.isArray(payload) ? payload : [];
  } catch (_) {
    return [];
  }
}

function getPopularMovies(limit = 12) {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.floor(limit), 1), 30)
    : 12;

  return runQuery(`
    SELECT
      p.id,
      p.titulo,
      p.slug,
      p.ruta_html,
      p.descripcion,
      p.sinopsis,
      p.director,
      p.reparto,
      p.estreno_texto,
      p.duracion,
      p.idioma,
      p.calificacion,
      p.poster_url,
      p.banner_url,
      p.embed_url,
      p.veo_embed_url,
      p.extra_embed_url,
      c.nombre AS categoria_nombre,
      c.slug AS categoria_slug,
      COALESCE(pp.vistas, 0) AS vistas,
      pp.updated_at AS popularidad_actualizada
    FROM peliculas p
    INNER JOIN categorias c ON c.id = p.categoria_id
    LEFT JOIN pelicula_popularidad pp ON pp.pelicula_id = p.id
    ORDER BY COALESCE(pp.vistas, 0) DESC, pp.updated_at DESC, p.titulo COLLATE NOCASE ASC
    LIMIT ${safeLimit};
  `);
}

function writeIndexFile(movies) {
  // regenerate the static index.html with the latest catalog cards
  const indexPath = path.join(ROOT, 'index.html');
  try {
    const newHtml = renderIndexFromTemplate(movies);
    fs.writeFileSync(indexPath, newHtml, 'utf8');
  } catch (err) {
    console.error('Error escribiendo index.html:', err);
  }
}

function refreshCacheFromDatabase() {
  const movies = getAllMovies();
  const bySlug = new Map();
  const byCategorySlug = new Map();

  for (const movie of movies) {
    bySlug.set(movie.slug, movie);
    byCategorySlug.set(`${movie.categoria_slug}/${movie.slug}`, movie);
  }

  moviesCache = movies;
  movieBySlugCache = bySlug;
  movieByCategorySlugCache = byCategorySlug;
  renderedIndexCache = renderIndexFromTemplate(moviesCache);

  // also update the static index.html so that even file:// usage shows the
  // latest movies without manual edits
  writeIndexFile(moviesCache);
}

function renderCatalogCards(movies = []) {
  const list = Array.isArray(movies) ? movies : [];
  return list
    .map((movie) => {
      const href = `peliculas/${movie.categoria_slug}/${movie.slug}.html`;
      const title = escapeHtml(movie.titulo || 'Sin titulo');
      const poster = escapeHtml(movie.poster_url || 'img/poster-fallback.svg');
      const posterFallbacks = [
        'img/poster-fallback.svg',
        './img/poster-fallback.svg',
        '/img/poster-fallback.svg',
      ].join('|');
      const alt = `Poster de ${title}`;
      const meta = [movie.categoria_nombre, movie.duracion].filter(Boolean).join(' • ');

      // compute modification time of the HTML file to allow "recent" logic offline
      let mtime = 0;
      try {
        const filePath = path.join(ROOT, movie.ruta_html || '');
        if (fs.existsSync(filePath)) {
          mtime = fs.statSync(filePath).mtimeMs || 0;
        }
      } catch (_) {
        mtime = 0;
      }

      return [
        `<article class="catalog-card" data-mtime="${mtime}">`,
        '<div class="catalog-poster">',
        `<img alt="${alt}" loading="lazy" src="${poster}" data-fallbacks="${posterFallbacks}" onerror="this.onerror=null;var l=(this.dataset.fallbacks||'').split('|').map(function(s){return s.trim();}).filter(Boolean);var i=parseInt(this.dataset.fallbackIndex||'0',10)||0;var n=l[i];if(n){this.dataset.fallbackIndex=String(i+1);this.src=n;}"/>`,
        '</div>',
        `<div class="catalog-title">${title}</div>`,
        `<div class="catalog-meta">${escapeHtml(meta || 'N/D')}</div>`,
        `<a class="catalog-button" href="${escapeHtml(href)}">Ver ahora</a>`,
        '</article>',
      ].join('');
    })
    .join('\n');
}

function renderFeaturedCards(movies, limit = 10) {
  const posterFallbacks = [
    'img/poster-fallback.svg',
    './img/poster-fallback.svg',
    '/img/poster-fallback.svg',
  ].join('|');
  return movies
    .slice(0, limit)
    .map((movie) => {
      const href = `peliculas/${movie.categoria_slug}/${movie.slug}.html`;
      const title = escapeHtml(movie.titulo || 'Sin titulo');
      const poster = escapeHtml(movie.poster_url || 'img/poster-fallback.svg');
      const meta = [movie.categoria_nombre, movie.duracion].filter(Boolean).join(' • ');
      const alt = `Poster de ${title}`;
      return [
        '<article class="featured-card" role="listitem">',
        '<div class="featured-poster">',
        `<img alt="${alt}" loading="lazy" src="${poster}" data-fallbacks="${posterFallbacks}" onerror="this.onerror=null;var l=(this.dataset.fallbacks||'').split('|').map(function(s){return s.trim();}).filter(Boolean);var i=parseInt(this.dataset.fallbackIndex||'0',10)||0;var n=l[i];if(n){this.dataset.fallbackIndex=String(i+1);this.src=n;}"/>`,
        '</div>',
        `<div class="featured-title">${title}</div>`,
        `<div class="featured-meta">${escapeHtml(meta || 'N/D')}</div>`,
        `<a class="featured-button" href="${escapeHtml(href)}">Ver ahora</a>`,
        '</article>',
      ].join('');
    })
    .join('\n');
}

function renderRecentCards(movies, limit = 20) {
  const posterFallbacks = [
    'img/poster-fallback.svg',
    './img/poster-fallback.svg',
    '/img/poster-fallback.svg',
  ].join('|');
  return movies
    .slice(0, limit)
    .map((movie) => {
      const href = `peliculas/${movie.categoria_slug}/${movie.slug}.html`;
      const title = escapeHtml(movie.titulo || 'Sin titulo');
      const poster = escapeHtml(movie.poster_url || 'img/poster-fallback.svg');
      const meta = [movie.categoria_nombre, movie.duracion].filter(Boolean).join(' • ');
      const alt = `Poster de ${title}`;
      return [
        '<article class="featured-card" role="listitem">',
        '<div class="featured-poster">',
        `<img alt="${alt}" loading="lazy" src="${poster}" data-fallbacks="${posterFallbacks}" onerror="this.onerror=null;var l=(this.dataset.fallbacks||'').split('|').map(function(s){return s.trim();}).filter(Boolean);var i=parseInt(this.dataset.fallbackIndex||'0',10)||0;var n=l[i];if(n){this.dataset.fallbackIndex=String(i+1);this.src=n;}"/>`,
        '</div>',
        `<div class="featured-title">${title}</div>`,
        `<div class="featured-meta">${escapeHtml(meta || 'N/D')}</div>`,
        `<a class="featured-button" href="${escapeHtml(href)}">Ver ahora</a>`,
        '</article>',
      ].join('');
    })
    .join('\n');
}

function loadSeriesData() {
  const files = walkHtmlFiles(SERIES_DIR);
  if (files.length === 0) return [];
  
  return files.map(filePath => {
    try {
      const html = fs.readFileSync(filePath, 'utf8');
      const parsed = parseSeriesHtml(filePath, html);
      const dataMatch = html.match(SERIES_DATA_REGEX);
      const internalData = dataMatch ? JSON.parse(dataMatch[1]) : {};
      
      return {
        title: parsed.titulo,
        slug: parsed.slug,
        poster: parsed.posterUrl,
        banner: parsed.bannerUrl,
        description: parsed.sinopsis || parsed.descripcion,
        genres: internalData.genres || ['Serie'],
        added_at: new Date(fs.statSync(filePath).mtimeMs).toISOString()
      };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
}

const SERIES_DATA_REGEX = /<script[^>]*id=["']series-data["'][^>]*>([\s\S]*?)<\/script>/i;

function readSeriesDataFromHtml(html) {
  const match = html.match(SERIES_DATA_REGEX);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    return { data, raw: match[1] };
  } catch (_) {
    return null;
  }
}

function writeSeriesDataToHtml(html, data) {
  const json = JSON.stringify(data, null, 2);
  return html.replace(SERIES_DATA_REGEX, (full, captured) => {
    return full.replace(captured, `\n${json}\n`);
  });
}

function ensureSeriesEpisodesAddedAt(filePath, html) {
  const parsed = readSeriesDataFromHtml(html);
  if (!parsed) return { html, data: null, updated: false };
  const data = parsed.data || {};
  const seasons = Array.isArray(data.seasons) ? data.seasons : [];
  let updated = false;
  const nowIso = new Date().toISOString();
  seasons.forEach((season) => {
    const episodes = Array.isArray(season?.episodes) ? season.episodes : [];
    episodes.forEach((ep) => {
      if (!ep || typeof ep !== 'object') return;
      if (!ep.added_at) {
        ep.added_at = nowIso;
        updated = true;
      }
    });
  });
  if (!updated) return { html, data, updated: false };
  const nextHtml = writeSeriesDataToHtml(html, data);
  try {
    fs.writeFileSync(filePath, nextHtml, 'utf8');
  } catch (_) {}
  return { html: nextHtml, data, updated: true };
}

function renderSeriesCards(series, limit = 20) {
  const posterFallbacks = [
    'img/poster-fallback.svg',
    './img/poster-fallback.svg',
    '/img/poster-fallback.svg',
  ].join('|');
  return series
    .slice(0, limit)
    .map((item) => {
      const href = `series/${item.slug || ''}.html`;
      const title = escapeHtml(item.title || 'Serie');
      const poster = escapeHtml(item.poster || 'img/poster-fallback.svg');
      const genres = Array.isArray(item.genres) ? item.genres : [];
      const meta = genres.length ? genres.join(' • ') : '';
      const dataGenres = genres
        .map((genre) => String(genre || '').trim().toLowerCase())
        .filter(Boolean)
        .join('|');
      const alt = `Poster de ${title}`;
      return [
        `<article class="series-card" role="listitem" data-genres="${escapeHtml(dataGenres)}">`,
        '<div class="series-poster">',
        `<img alt="${alt}" loading="lazy" src="${poster}" data-fallbacks="${posterFallbacks}" onerror="this.onerror=null;var l=(this.dataset.fallbacks||'').split('|').map(function(s){return s.trim();}).filter(Boolean);var i=parseInt(this.dataset.fallbackIndex||'0',10)||0;var n=l[i];if(n){this.dataset.fallbackIndex=String(i+1);this.src=n;}"/>`,
        '</div>',
        `<div class="series-title">${title}</div>`,
        `<div class="series-meta">${escapeHtml(meta || 'N/D')}</div>`,
        `<a class="series-button" href="${escapeHtml(href)}">Ver serie</a>`,
        '</article>',
      ].join('');
    })
    .join('\n');
}

function renderSeriesFeaturedCards(series, limit = 20) {
  const posterFallbacks = [
    'img/poster-fallback.svg',
    './img/poster-fallback.svg',
    '/img/poster-fallback.svg',
  ].join('|');
  return series
    .slice(0, limit)
    .map((item) => {
      const href = `series/${item.slug || ''}.html`;
      const title = escapeHtml(item.title || 'Serie');
      const poster = escapeHtml(item.poster || 'img/poster-fallback.svg');
      const genres = Array.isArray(item.genres) ? item.genres : [];
      const meta = genres.length ? genres.join(' • ') : '';
      const dataGenres = genres
        .map((genre) => String(genre || '').trim().toLowerCase())
        .filter(Boolean)
        .join('|');
      const alt = `Poster de ${title}`;
      return [
        `<article class="featured-card" role="listitem" data-genres="${escapeHtml(dataGenres)}">`,
        '<div class="featured-poster">',
        `<img alt="${alt}" loading="lazy" src="${poster}" data-fallbacks="${posterFallbacks}" onerror="this.onerror=null;var l=(this.dataset.fallbacks||'').split('|').map(function(s){return s.trim();}).filter(Boolean);var i=parseInt(this.dataset.fallbackIndex||'0',10)||0;var n=l[i];if(n){this.dataset.fallbackIndex=String(i+1);this.src=n;}"/>`,
        '</div>',
        `<div class="featured-title">${title}</div>`,
        `<div class="featured-meta">${escapeHtml(meta || 'N/D')}</div>`,
        `<a class="featured-button" href="${escapeHtml(href)}">Ver serie</a>`,
        '</article>',
      ].join('');
    })
    .join('\n');
}

function renderRecentEpisodeCards(episodes, limit = 20) {
  const posterFallbacks = [
    'img/banner-fallback.svg',
    './img/banner-fallback.svg',
    '/img/banner-fallback.svg',
  ].join('|');

  if (!episodes.length) {
    return '<p class="section-subtitle">No hay capitulos recientes por ahora.</p>';
  }

  return episodes
    .slice(0, limit)
    .map((episode) => {
      const title = escapeHtml(episode.seriesTitle || 'Serie');
      const epTitle = escapeHtml(episode.episodeTitle || 'Episodio');
      const seasonLabel = `T${episode.seasonNumber}`;
      const episodeLabel = `E${episode.episodeNumber}`;
      const badge = `${seasonLabel} • ${episodeLabel}`;
      const meta = `${seasonLabel} • ${episodeLabel} • ${epTitle}`;
      const href = `series/${episode.slug}.html?season=${episode.seasonNumber}&episode=${episode.episodeNumber}`;
      const banner = escapeHtml(episode.banner || 'img/banner-fallback.svg');

      return [
        `<a href="${escapeHtml(href)}" class="featured-card" role="listitem" style="flex: 0 0 220px; min-width: 220px; text-decoration: none; color: inherit; scroll-snap-align: start; padding: 12px; background: #0f1322; border: 1px solid #232742; border-radius: 14px;">`,
        '<div class="featured-poster" style="aspect-ratio: 16/9; position: relative; overflow: hidden; border-radius: 8px; margin-bottom: 10px; border: 1px solid #242a44;">',
        `<span class="episode-badge" style="position: absolute; top: 8px; right: 8px; z-index: 2; background: rgba(7, 9, 16, 0.9); border: 1px solid #2a3152; color: #f4f6ff; padding: 2px 6px; border-radius: 6px; font-size: 10px; font-weight: bold;">${badge}</span>`,
        `<img alt="Miniatura de ${title}" loading="lazy" src="${banner}" style="width: 100%; height: 100%; object-fit: cover; display: block;" data-fallbacks="${posterFallbacks}" onerror="this.onerror=null;var l=(this.dataset.fallbacks||'').split('|').map(function(s){return s.trim();}).filter(Boolean);var i=parseInt(this.dataset.fallbackIndex||'0',10)||0;var n=l[i];if(n){this.dataset.fallbackIndex=String(i+1);this.src=n;}"/>`,
        '</div>',
        `<div class="featured-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; font-weight: 700; color: #e8e8f0; margin-bottom: 4px;">${epTitle}</div>`,
        `<div class="featured-meta" style="font-size: 12px; color: #9aa0b4;">${title} • ${seasonLabel}${episodeLabel}</div>`,
        '</a>',
      ].join('');
    })
    .join('\n');
}

function getRecentEpisodesFromSeries(days = 365, perSeriesLimit = 50, limit = 100) {
  const cutoff = Date.now() - (days || 365) * 24 * 60 * 60 * 1000;
  const files = walkHtmlFiles(SERIES_DIR);
  const episodes = [];

  files.forEach((filePath) => {
    let html = '';
    try {
      html = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      return;
    }

    const ensured = ensureSeriesEpisodesAddedAt(filePath, html);
    const data = ensured.data;
    if (!data) return;

    const seriesInfo = parseSeriesHtml(filePath, ensured.html);
    const seriesTitle = seriesInfo.titulo || seriesInfo.slug || 'Serie';
    const banner = seriesInfo.bannerUrl || seriesInfo.posterUrl || 'img/banner-fallback.svg';

    const seasons = Array.isArray(data.seasons) ? data.seasons : [];
    const seriesEpisodes = [];
    seasons.forEach((season, seasonIdx) => {
      const seasonNumber = Number(season?.number || seasonIdx + 1);
      const eps = Array.isArray(season?.episodes) ? season.episodes : [];
      eps.forEach((ep, epIdx) => {
        const sources = Array.isArray(ep?.sources) ? ep.sources : [];
        if (!sources.find((item) => item && item.src)) return;
        const addedAtMs = Date.parse(String(ep.added_at || '')) || Date.now();
        // Eliminamos el filtro de fecha para asegurar que aparezcan los capitulos.
        const episodeNumber = Number(ep?.number || epIdx + 1);
        seriesEpisodes.push({
          slug: seriesInfo.slug,
          seriesTitle,
          banner: ep?.img || ep?.image || banner,
          seasonNumber,
          episodeNumber,
          episodeTitle: ep?.title || `Episodio ${episodeNumber}`,
          addedAtMs,
        });
      });
    });

    // Ordenar episodios de la misma serie: fecha, luego temporada y episodio descendente
    seriesEpisodes.sort((a, b) => {
      if (b.addedAtMs !== a.addedAtMs) return b.addedAtMs - a.addedAtMs;
      if (b.seasonNumber !== a.seasonNumber) return b.seasonNumber - a.seasonNumber;
      return b.episodeNumber - a.episodeNumber;
    });

    seriesEpisodes
      .slice(0, perSeriesLimit)
      .forEach((ep) => episodes.push(ep));
  });

  // Ordenar lista global: fecha, luego agrupar por serie y finalmente temp/ep
  return episodes.sort((a, b) => {
    if (b.addedAtMs !== a.addedAtMs) return b.addedAtMs - a.addedAtMs;
    if (a.seriesTitle !== b.seriesTitle) return a.seriesTitle.localeCompare(b.seriesTitle);
    if (b.seasonNumber !== a.seasonNumber) return b.seasonNumber - a.seasonNumber;
    return b.episodeNumber - a.episodeNumber;
  }).slice(0, limit);
}

function renderIndexFromTemplate(movies = []) {
  const movieList = Array.isArray(movies) ? movies : [];
  const indexPath = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const cards = renderCatalogCards(movieList);
  const startToken = '<div class="catalog-grid" id="catalog-grid">';
  const endToken = '<div class="catalog-pagination" id="catalog-pagination" aria-label="Paginado"></div>';
  const startIndex = html.indexOf(startToken);
  const endIndex = html.indexOf(endToken);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = html.slice(0, startIndex + startToken.length);
    const after = html.slice(endIndex);
    html = `${before}\n${cards}\n</div>\n  ${after}`;
  }

  const popular = getPopularMovies(10);
  const featuredMovies = popular.length ? popular : movieList.slice(0, 10);
  const featuredCards = renderFeaturedCards(featuredMovies, 10);
  const featuredStartToken = '<div class="featured-row" id="featured-row" role="list">';
  const featuredEndToken = '</div>\n</section>';
  const featuredStartIndex = html.indexOf(featuredStartToken);
  const featuredEndIndex = html.indexOf(featuredEndToken, featuredStartIndex);

  if (featuredStartIndex !== -1 && featuredEndIndex !== -1) {
    const featuredBefore = html.slice(0, featuredStartIndex + featuredStartToken.length);
    const featuredAfter = html.slice(featuredEndIndex);
    html = `${featuredBefore}\n${featuredCards}\n${featuredAfter}`;
  }

  const recentStartToken = '<div class="featured-row" id="recent-row" role="list">';
  const recentStartIndex = html.indexOf(recentStartToken);
  const recentEndIndex = html.indexOf(featuredEndToken, recentStartIndex);
  if (recentStartIndex !== -1 && recentEndIndex !== -1) {
    const recentMovies = getRecentMovies(20);
    const recentCards = renderRecentCards(recentMovies, 20);
    const recentBefore = html.slice(0, recentStartIndex + recentStartToken.length);
    const recentAfter = html.slice(recentEndIndex);
    html = `${recentBefore}\n${recentCards}\n${recentAfter}`;
  }

  const seriesData = loadSeriesData();
  const seriesPopularToken = '<div class="featured-row" id="series-popular-grid" role="list">';
  const seriesPopularStart = html.indexOf(seriesPopularToken);
  const seriesPopularEnd = html.indexOf('</div>\n</section>', seriesPopularStart);
  if (seriesPopularStart !== -1 && seriesPopularEnd !== -1) {
    const popularSeries = seriesData.slice();
    const seriesPopularCards = renderSeriesFeaturedCards(popularSeries, 20);
    const before = html.slice(0, seriesPopularStart + seriesPopularToken.length);
    const after = html.slice(seriesPopularEnd);
    html = `${before}\n${seriesPopularCards}\n${after}`;
  }

  const seriesRecentToken = '<div class="featured-row" id="series-recent-grid" role="list">';
  const seriesRecentStart = html.indexOf(seriesRecentToken);
  const seriesRecentEnd = html.indexOf('</div>\n</section>', seriesRecentStart);
  if (seriesRecentStart !== -1 && seriesRecentEnd !== -1) {
    const recentSeries = seriesData
      .slice()
      .sort((a, b) => String(b.added_at || '').localeCompare(String(a.added_at || '')));
    const seriesRecentCards = renderSeriesFeaturedCards(recentSeries, 20);
    const before = html.slice(0, seriesRecentStart + seriesRecentToken.length);
    const after = html.slice(seriesRecentEnd);
    html = `${before}\n${seriesRecentCards}\n${after}`;
  }

  const seriesToken = '<div class="series-grid compact-results" id="series-grid">';
  const seriesStart = html.indexOf(seriesToken);
  const seriesEnd = html.indexOf('</div>\n</section>', seriesStart);
  if (seriesStart !== -1 && seriesEnd !== -1) {
    const seriesCards = renderSeriesCards(seriesData, 200);
    const before = html.slice(0, seriesStart + seriesToken.length);
    const after = html.slice(seriesEnd);
    html = `${before}\n${seriesCards}\n${after}`;
  }

  const recentEpisodesStart = html.indexOf('id="recent-episodes-row"');
  const recentEpisodesEnd = html.indexOf('</div>\n</section>', recentEpisodesStart);
  if (recentEpisodesStart !== -1 && recentEpisodesEnd !== -1) {
    const tagStart = html.lastIndexOf('<div', recentEpisodesStart);
    const recentEpisodes = getRecentEpisodesFromSeries(90, 50, 100);
    if (recentEpisodes.length > 0) {
      const recentCards = renderRecentEpisodeCards(recentEpisodes, 100);
      const before = html.slice(0, tagStart);
      const after = html.slice(recentEpisodesEnd);
      html = `${before}<div class="featured-row" id="recent-episodes-row" role="list" style="display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 16px; padding: 10px 0 20px; scroll-snap-type: x mandatory; scrollbar-width: none; -ms-overflow-style: none; -webkit-overflow-scrolling: touch; scroll-behavior: smooth; margin-top: 10px;">\n${recentCards}\n${after}`;
    }
  }

  const heroMovie = featuredMovies[0] || movieList[0];
  if (heroMovie) {
    const heroTitle = escapeHtml(heroMovie.titulo || 'Pelicula');
    const heroPoster = escapeHtml(heroMovie.poster_url || 'img/poster-fallback.svg');
    const heroMeta = escapeHtml(
      [heroMovie.categoria_nombre, heroMovie.duracion].filter(Boolean).join(' • ') || 'N/D'
    );
    const heroHref = escapeHtml(`peliculas/${heroMovie.categoria_slug}/${heroMovie.slug}.html`);
    const heroImg = `<img alt="Poster oficial de ${heroTitle}" loading="lazy" src="${heroPoster}"/>`;

    html = html.replace(
      /(<div class="poster">\s*<span class="poster-tag">Cartelera<\/span>\s*)<img[^>]*>/,
      `$1${heroImg}`
    );
    html = html.replace(/(<div class="card-title">)([^<]*)(<\/div>)/, `$1${heroTitle}$3`);
    html = html.replace(/(<div class="card-meta">)([^<]*)(<\/div>)/, `$1${heroMeta}$3`);
    html = html.replace(/(<a class="card-button" href=")([^"]*)(")/, `$1${heroHref}$3`);
  }

  return html;
}

function renderMoviePage(movie) {
  const toMovieRelative = (url) => {
    const value = String(url || '');
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/')) return `../..${value}`;
    return value;
  };

  const title = escapeHtml(movie.titulo || 'Pelicula');
  const description = escapeHtml(movie.descripcion || `Mira ${movie.titulo || 'esta pelicula'} en Ultrapelis.`);
  const synopsis = escapeHtml(movie.sinopsis || 'Sinopsis no disponible.');
  const director = escapeHtml(movie.director || 'N/D');
  const cast = escapeHtml(movie.reparto || 'N/D');
  const release = escapeHtml(movie.estreno_texto || 'N/D');
  const duration = escapeHtml(movie.duracion || 'N/D');
  const language = escapeHtml(movie.idioma || 'N/D');
  const rating = escapeHtml(movie.calificacion || 'N/D');
  const poster = escapeHtml(toMovieRelative(movie.poster_url || '/img/poster-fallback.svg'));
  const banner = escapeHtml(toMovieRelative(movie.banner_url || '/img/banner-fallback.svg'));
  const getUrlWithVer = (url) => (url ? `${url}${url.includes('?') ? '&' : '?'}v=20260328` : '');
  const bannerWithVer = getUrlWithVer(banner);
  const posterWithVer = getUrlWithVer(poster);
  const embed = escapeHtml(movie.embed_url || '');
  const veoEmbed = escapeHtml(movie.veo_embed_url || '');
  const extraEmbed = escapeHtml(movie.extra_embed_url || '');
  const hasPrimary = Boolean(movie.embed_url);
  const hasVeo = Boolean(movie.veo_embed_url);
  const hasExtra = Boolean(movie.extra_embed_url);
  const serverButtons = [
    hasPrimary
      ? `<button class="server-btn is-active" data-src="${embed}" type="button">Español (Latino)</button>`
      : '<button class="server-btn is-active" data-src="" type="button">Español (Latino)</button>',
    hasVeo
      ? `<button class="server-btn" data-src="${veoEmbed}" type="button">Español (Latino 2)</button>`
      : '<button class="server-btn" data-src="" type="button">Español (Latino 2)</button>',
    hasExtra
      ? `<button class="server-btn" data-src="${extraEmbed}" type="button">Español (Latino 3)</button>`
      : '<button class="server-btn" data-src="" type="button">Español (Latino 3)</button>',
  ]
    .filter(Boolean)
    .join('\n        ');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="description" content="${description}"/>
  <meta name="keywords" content="peliculas, series, estrenos, cine, ultrapelis"/>
  <meta name="robots" content="index, follow"/>
  <meta name="theme-color" content="#111827"/>
  <meta property="og:title" content="${title} | Ultrapelis"/>
  <meta property="og:description" content="${description}"/>
  <meta property="og:image" content="${poster}"/>
  <meta property="og:type" content="video.movie"/>
  <meta property="og:site_name" content="Ultrapelis"/>
  <meta property="og:locale" content="es_MX"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${title} | Ultrapelis"/>
  <meta name="twitter:description" content="${description}"/>
  <meta name="twitter:image" content="${poster}"/>
  <title>${title} | Ultrapelis</title>
  <link href="../../img/favicon.png" rel="icon" type="image/png"/>
  <link href="../../img/favicon.png" rel="apple-touch-icon"/>
  <link href="../../style.css?v=20260305" rel="stylesheet"/>
  <link href="../../peliculas.css?v=20260305" rel="stylesheet"/>
  <style>
    @media (max-width: 900px) {
      .hero-movie .hero-content { text-align: center; }
      /* Colapsa la ficha tecnica a una columna */
      .info-grid {
        grid-template-columns: 1fr;
      }
      /* Footer responsivo */
      .footer-inner {
        flex-direction: column;
        text-align: center;
        gap: 1rem;
      }
      .footer-links {
        flex-direction: column;
        gap: 0.5rem;
      }
    }
  </style>
  <script defer src="../../movie.js?v=20260307"></script>
</head>
<body data-movie-id="${escapeHtml(movie.slug)}">
  <header class="topbar">
    <div class="brand">Ultrapelis</div>
    <a class="card-button" href="../../index.html">Volver</a>
  </header>
  <main>
    <section aria-labelledby="movie-title" class="hero-movie hero" style="--movie-bg: url('${bannerWithVer}'), url('${posterWithVer}');">
      <div class="hero-content">
        <p class="hero-kicker">Pelicula</p>
        <h1 id="movie-title">${title}</h1>
        <p class="hero-copy">${escapeHtml([movie.categoria_nombre, movie.duracion].filter(Boolean).join(' • '))}</p>
      </div>
    </section>

    <section aria-labelledby="details-title" class="movie-details">
      <h2 id="details-title">Ficha tecnica</h2>
      <div class="info-grid">
        <div class="info-card"><h3>Director</h3><p>${director}</p></div>
        <div class="info-card"><h3>Reparto principal</h3><p>${cast}</p></div>
        <div class="info-card"><h3>Estreno</h3><p>${release}</p></div>
        <div class="info-card"><h3>Duracion</h3><p>${duration}</p></div>
        <div class="info-card"><h3>Idiomas</h3><p>${language}</p></div>
        <div class="info-card"><h3>Calificacion</h3><p>${rating}</p></div>
      </div>
    </section>

    <section aria-labelledby="synopsis-title" class="movie-details">
      <h2 id="synopsis-title">Sinopsis</h2>
      <p class="synopsis">${synopsis}</p>
    </section>

    <section aria-labelledby="player-title" class="player">
      <div class="player-header">
        <h2 id="player-title">Ver ahora</h2>
        <p id="player-note">Selecciona un servidor disponible.</p>
      </div>
      <div aria-label="Servidores" class="server-list" role="tablist">
        ${serverButtons}
      </div>
      <div class="player-frame">
        <iframe allow="autoplay; fullscreen; picture-in-picture" allowfullscreen id="player-iframe" src="" title="Reproductor de video"></iframe>
      </div>
    </section>

    <section aria-labelledby="cast-title" class="cast-section">
      <div class="cast-header">
        <h2 id="cast-title">Abrir en Web Video Cast</h2>
        <p>Envía esta película a la app para reproducirla en tu TV.</p>
      </div>
      <div class="cast-actions">
        <button class="cast-btn" id="cast-open-app" type="button">Abrir en la app</button>
        <a class="cast-btn ghost" id="cast-get-app" href="https://play.google.com/store/apps/details?id=com.instantbits.cast.webvideo&hl=es_MX&pli=1" rel="noopener" target="_blank">Instalar app</a>
        <button class="cast-btn ghost" id="cast-copy-page" type="button">Copiar enlace</button>
      </div>
      <p class="cast-status" id="cast-status" aria-live="polite"></p>
    </section>

    <section aria-labelledby="report-title" class="report-section">
      <div class="report-header">
        <h2 id="report-title">Reportar un problema</h2>
        <p>Si algo falla en el reproductor o el video, cuentanos que paso.</p>
      </div>
      <form class="report-form" id="report-form" novalidate action="mailto:soporteultrapelis@gmail.com" method="get" enctype="text/plain" target="_blank">
        <label class="report-field">
          <span>Tu correo (opcional)</span>
          <input id="report-email" type="email" placeholder="tucorreo@ejemplo.com" autocomplete="email"/>
        </label>
        <label class="report-field">
          <span>Describe el problema</span>
          <textarea id="report-message" rows="4" placeholder="Ej: el servidor 2 no carga, se queda en negro."></textarea>
        </label>
        <div class="report-actions">
          <button class="report-btn" type="submit">Enviar reporte</button>
          <a class="report-link" id="report-mailto" href="mailto:soporteultrapelis@gmail.com">Enviar por correo</a>
          <button class="report-btn ghost" id="report-copy" type="button">Copiar reporte</button>
        </div>
        <p class="report-status" id="report-status" aria-live="polite"></p>
      </form>
    </section>
  </main>

  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-brand">Ultrapelis</div>
      <p class="footer-copy">Tu cine en casa. Estrenos, clasicos y recomendaciones en un solo lugar.</p>
      <div class="footer-links">
        <a href="../../index.html">Inicio</a>
        <a href="../../index.html#catalog">Catalogo</a>
        <a href="#">Contacto</a>
      </div>
      <p class="footer-rights">© 2026 Ultrapelis. Todos los derechos reservados.</p>
    </div>
  </footer>
</body>
</html>`;
}

function getBaseUrl(req) {
  const host = req.headers.host || `localhost:${PORT}`;
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const protocol = protoHeader === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}

function toAbsoluteUrl(baseUrl, value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith('/')) return `${baseUrl}${text}`;
  return `${baseUrl}/${text.replace(/^\/+/, '')}`;
}

function toStremioId(slug) {
  return `${ADDON_ID_PREFIX}${normalizeSlug(slug)}`;
}

function parseStremioMovieId(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  if (raw.startsWith(ADDON_ID_PREFIX)) {
    return normalizeSlug(raw.slice(ADDON_ID_PREFIX.length));
  }
  return normalizeSlug(raw);
}

function toStremioSeriesId(slug) {
  const safe = normalizeSlug(slug);
  return safe ? `${SERIES_ID_PREFIX}${safe}` : '';
}

function parseStremioSeriesId(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  if (raw.startsWith(SERIES_ID_PREFIX)) {
    return normalizeSlug(raw.slice(SERIES_ID_PREFIX.length));
  }
  return '';
}

function parseStremioSeriesVideoId(id) {
  const raw = String(id || '').trim();
  if (!raw.startsWith(SERIES_ID_PREFIX)) return null;
  const rest = raw.slice(SERIES_ID_PREFIX.length);
  const parts = rest.split(':');
  const slug = normalizeSlug(parts[0] || '');
  const episodePart = parts[1] || '';
  const match = episodePart.match(/^s(\d+)e(\d+)$/i);
  if (!slug || !match) return null;
  return {
    slug,
    season: Number.parseInt(match[1], 10),
    episode: Number.parseInt(match[2], 10),
  };
}

function toStremioMeta(movie, baseUrl) {
  if (!movie) return null;
  return {
    id: toStremioId(movie.slug),
    type: 'movie',
    name: movie.titulo || movie.slug,
    description: movie.descripcion || movie.sinopsis || '',
    poster: toAbsoluteUrl(baseUrl, movie.poster_url || ''),
    background: toAbsoluteUrl(baseUrl, movie.banner_url || movie.poster_url || ''),
    logo: toAbsoluteUrl(baseUrl, movie.poster_url || ''),
    releaseInfo: movie.estreno_texto || '',
    runtime: movie.duracion || '',
    genres: movie.categoria_nombre ? [movie.categoria_nombre] : [],
  };
}

function toStremioSeriesMeta(serie, baseUrl, videos = null) {
  if (!serie) return null;
  const slug = String(serie.slug || '').trim();
  const id = toStremioSeriesId(slug);
  if (!id) return null;
  const genres = Array.isArray(serie.genres) ? serie.genres : [];
  const meta = {
    id,
    type: 'series',
    name: serie.title || slug,
    description: serie.description || '',
    poster: toAbsoluteUrl(baseUrl, serie.poster || ''),
    background: toAbsoluteUrl(baseUrl, serie.banner || serie.poster || ''),
    logo: toAbsoluteUrl(baseUrl, serie.poster || ''),
    releaseInfo: '',
    genres,
  };
  if (Array.isArray(videos)) meta.videos = videos;
  return meta;
}

function enrichSeriesFromHtml(serie) {
  if (!serie) return serie;
  const slug = String(serie.slug || '').trim();
  if (!slug) return serie;
  const filePath = path.join(SERIES_DIR, `${slug}.html`);
  if (!fs.existsSync(filePath)) return serie;
  try {
    const html = fs.readFileSync(filePath, 'utf8');
    const parsed = parseSeriesHtml(filePath, html);
    return {
      ...serie,
      poster: serie.poster || parsed.posterUrl || serie.poster,
      banner: serie.banner || parsed.bannerUrl || serie.banner,
    };
  } catch (_) {
    return serie;
  }
}

function parseSeriesVideos(filePath, html, slug) {
  const parsed = readSeriesDataFromHtml(html);
  if (!parsed || !parsed.data) return [];
  const data = parsed.data;
  const seasons = Array.isArray(data.seasons) ? data.seasons : [];
  const videos = [];
  seasons.forEach((season, sIdx) => {
    const seasonNumber = Number(season?.number || sIdx + 1);
    const eps = Array.isArray(season?.episodes) ? season.episodes : [];
    eps.forEach((ep, eIdx) => {
      const episodeNumber = Number(ep?.number || eIdx + 1);
      const title = String(ep?.title || `Episodio ${episodeNumber}`);
      const id = `${toStremioSeriesId(slug)}:s${seasonNumber}e${episodeNumber}`;
      const released = ep.added_at || new Date().toISOString();
      videos.push({
        id,
        title,
        season: seasonNumber,
        episode: episodeNumber,
        released
      });
    });
  });
  return videos;
}

function parseSeriesEpisodeSources(filePath, html) {
  const parsed = readSeriesDataFromHtml(html);
  if (!parsed || !parsed.data) return new Map();
  const data = parsed.data;
  const seasons = Array.isArray(data.seasons) ? data.seasons : [];
  const out = new Map();
  seasons.forEach((season, sIdx) => {
    const seasonNumber = Number(season?.number || sIdx + 1);
    const eps = Array.isArray(season?.episodes) ? season.episodes : [];
    eps.forEach((ep, eIdx) => {
      const episodeNumber = Number(ep?.number || eIdx + 1);
      const sources = Array.isArray(ep?.sources) ? ep.sources : [];
      const key = `s${seasonNumber}e${episodeNumber}`;
      out.set(key, sources);
    });
  });
  return out;
}

function getMoviePageUrl(movie, baseUrl) {
  if (!movie) return '';
  return `${baseUrl}/peliculas/${movie.categoria_slug}/${movie.slug}.html`;
}

function buildStremioStreams(movie, baseUrl) {
  const streams = [];
  const pushStream = (label, rawUrl, behaviorHints = null) => {
    const url = String(rawUrl || '').trim();
    if (!url) return;
    const isDirect = isDirectMediaUrl(url);
    const hints = !isDirect
      ? { notWebReady: true, ...(behaviorHints || {}) }
      : behaviorHints;
    streams.push({
      name: ADDON_NAME,
      title: label,
      ...(isDirect ? { url } : { externalUrl: url }),
      ...(hints ? { behaviorHints: hints } : {}),
    });
  };

  pushStream('Servidor principal', movie.embed_url);
  pushStream('Servidor alterno', movie.veo_embed_url);
  pushStream('Servidor 3', movie.extra_embed_url);

  const pageUrl = getMoviePageUrl(movie, baseUrl);
  if (pageUrl) {
    while (streams.length < 3) {
      streams.push({
        name: ADDON_NAME,
        title: `Servidor ${streams.length + 1}`,
        externalUrl: pageUrl,
        behaviorHints: { notWebReady: true },
      });
    }
    streams.push({
      name: ADDON_NAME,
      title: 'Ver en Ultrapelis',
      externalUrl: pageUrl,
      behaviorHints: { notWebReady: true },
    });
  }

  return streams;
}

function send(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function sendJson(res, statusCode, data) {
  send(res, statusCode, JSON.stringify(data), 'application/json; charset=utf-8');
}

function serveStaticFile(req, reqPath, res) {
  const unsafePath = decodeURIComponent(reqPath.split('?')[0]);
  const normalized = path.normalize(unsafePath).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(ROOT, normalized.startsWith('/') ? normalized.slice(1) : normalized);

  if (!filePath.startsWith(ROOT)) {
    send(res, 403, 'Forbidden');
    return true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  const stat = fs.statSync(filePath);
  const lastModified = stat.mtime.toUTCString();
  const ifModifiedSince = req.headers['if-modified-since'];
  if (ifModifiedSince && new Date(ifModifiedSince).getTime() >= stat.mtime.getTime()) {
    res.writeHead(304);
    res.end();
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  let content = fs.readFileSync(filePath);
  if (ext === '.html' && (filePath.includes(`${path.sep}peliculas${path.sep}`) || filePath.includes(`${path.sep}series${path.sep}`))) {
    try {
      const html = content.toString('utf8');
      const baseUrl = getBaseUrl(req);
      const videoInfos = buildVideoInfos(filePath, html, baseUrl);
      const jsonLd = buildVideoJsonLds(videoInfos);
      content = Buffer.from(injectVideoJsonLd(html, jsonLd), 'utf8');
    } catch (_) {
      // Si falla, se sirve el HTML original.
    }
  }
  const cacheControl = /\.(css|js|png|jpg|jpeg|webp|ico|svg)$/i.test(filePath)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=300';

  res.writeHead(200, {
    'Content-Type': mime,
    'Cache-Control': cacheControl,
    'Last-Modified': lastModified,
  });
  res.end(content);
  return true;
}

function startServer() {
  ensureDatabase();
  const synced = syncMoviesFromHtml();
  const doodSync = syncDoodstreamEmbeds();
  const veoSync = syncVeoEmbeds();

  const apiKey = String(process.env.TMDB_API_KEY || '').trim();
  if (apiKey && apiKey !== 'PEGA_TU_API_KEY_DE_TMDB_AQUI') {
    console.log('TMDB API Key encontrada. Sincronizando imágenes de TMDB en segundo plano...');
    syncTmdbImages()
      .then(result => {
        console.log(`Sincronización de TMDB completada: ${result.updated} actualizadas.`);
        if (result.missing.length > 0) {
          console.warn(`  - Slugs no encontrados en la BD: ${result.missing.join(', ')}`);
        }
        if (result.withoutImages.length > 0) {
          console.warn(`  - Películas sin imágenes en TMDB: ${result.withoutImages.join(', ')}`);
        }
      })
      .catch(err => {
        console.error('Error durante la sincronización automática de imágenes de TMDB:', err.message);
      });
  } else {
    console.log('No se encontró una TMDB_API_KEY válida en .env, se omitirá la sincronización de imágenes.');
  }

  try {
    maybeWriteSitemap();
  } catch (error) {
    console.warn('No se pudo generar sitemap.xml al iniciar:', error.message);
  }

  const server = http.createServer((req, res) => {
    Promise.resolve()
      .then(async () => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = (req.method || 'GET').toUpperCase();
      const baseUrl = getBaseUrl(req);
      if (method === 'GET') {
        try {
          maybeWriteSitemap();
        } catch (error) {
          console.warn('No se pudo refrescar sitemap.xml:', error.message);
        }
      }

      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Cache-Control': 'no-store',
        });
        return res.end();
      }

      // Manifiesto del addon para Stremio.
      if (pathname === '/manifest.json') {
        maybeSyncMoviesFromHtml();
        return sendJson(res, 200, {
          id: ADDON_ID,
          version: '1.0.1',
          name: ADDON_NAME,
          description: 'Catalogo y streams de Ultrapelis',
          resources: ['catalog', 'meta', 'stream'],
          types: ['movie', 'series'],
          idPrefixes: [ADDON_ID_PREFIX, SERIES_ID_PREFIX],
          catalogs: [
            {
              type: 'movie',
              id: ADDON_CATALOG_ID,
              name: 'Ultrapelis',
              extra: [{ name: 'search', isRequired: false }]
            },
            {
              type: 'series',
              id: ADDON_CATALOG_ID,
              name: 'Ultrapelis Series',
              extra: [{ name: 'search', isRequired: false }]
            },
          ],
          behaviorHints: {
            configurable: false,
            configurationRequired: false,
          },
        });
      }

      // Catálogo de películas para Stremio.
      if (pathname === `/catalog/movie/${ADDON_CATALOG_ID}.json`) {
        maybeSyncMoviesFromHtml();
        const query = url.searchParams.get('search');
        let filtered = moviesCache;

        if (query) {
          const q = query.toLowerCase();
          filtered = moviesCache.filter(m => 
            (m.titulo || '').toLowerCase().includes(q) || 
            (m.slug || '').toLowerCase().includes(q)
          );
        }

        const metas = filtered.map((movie) => toStremioMeta(movie, baseUrl)).filter(Boolean);
        return sendJson(res, 200, { metas });
      }

      if (pathname === `/catalog/series/${ADDON_CATALOG_ID}.json`) {
        const query = url.searchParams.get('search');
        let seriesData = loadSeriesData();

        if (query) {
          const q = query.toLowerCase();
          seriesData = seriesData.filter(s => 
            (s.title || '').toLowerCase().includes(q) || 
            (s.slug || '').toLowerCase().includes(q)
          );
        }

        const metas = seriesData
          .map((serie) => toStremioSeriesMeta(enrichSeriesFromHtml(serie), baseUrl))
          .filter(Boolean);
        return sendJson(res, 200, { metas });
      }

      // Metadatos de una película específica para Stremio.
      const addonMetaMatch = pathname.match(/^\/meta\/movie\/([^/]+)\.json$/i);
      if (addonMetaMatch) {
        maybeSyncMoviesFromHtml();
        const movieId = decodeURIComponent(addonMetaMatch[1] || '');
        const slug = parseStremioMovieId(movieId);
        const movie = movieBySlugCache.get(slug);
        if (!movie) return sendJson(res, 404, { err: 'Not found' });
        return sendJson(res, 200, { meta: toStremioMeta(movie, baseUrl) });
      }

      const seriesMetaMatch = pathname.match(/^\/meta\/series\/([^/]+)\.json$/i);
      if (seriesMetaMatch) {
        const seriesId = decodeURIComponent(seriesMetaMatch[1] || '');
        const slug = parseStremioSeriesId(seriesId);
        if (!slug) return sendJson(res, 404, { err: 'Not found' });
        const seriesData = loadSeriesData();
        const serieRaw = seriesData.find((item) => String(item.slug || '').trim() === slug);
        const serie = enrichSeriesFromHtml(serieRaw);
        if (!serie) return sendJson(res, 404, { err: 'Not found' });
        const filePath = path.join(SERIES_DIR, `${slug}.html`);
        let videos = [];
        if (fs.existsSync(filePath)) {
          try {
            const html = fs.readFileSync(filePath, 'utf8');
            videos = parseSeriesVideos(filePath, html, slug);
          } catch (_) {
            videos = [];
          }
        }
        return sendJson(res, 200, { meta: toStremioSeriesMeta(serie, baseUrl, videos) });
      }

      // Fuentes (streams) para una película específica en Stremio.
      const addonStreamMatch = pathname.match(/^\/stream\/movie\/([^/]+)\.json$/i);
      if (addonStreamMatch) {
        maybeSyncMoviesFromHtml();
        const movieId = decodeURIComponent(addonStreamMatch[1] || '');
        const slug = parseStremioMovieId(movieId);
        const movie = movieBySlugCache.get(slug);
        if (!movie) return sendJson(res, 200, { streams: [] });
        return sendJson(res, 200, { streams: buildStremioStreams(movie, baseUrl) });
      }

      const seriesStreamMatch = pathname.match(/^\/stream\/series\/([^/]+)\.json$/i);
      if (seriesStreamMatch) {
        const videoId = decodeURIComponent(seriesStreamMatch[1] || '');
        const parsed = parseStremioSeriesVideoId(videoId);
        if (!parsed) return sendJson(res, 404, { err: 'Not found' });
        const { slug, season, episode } = parsed;
        const filePath = path.join(SERIES_DIR, `${slug}.html`);
        if (!fs.existsSync(filePath)) return sendJson(res, 404, { err: 'Not found' });
        let sources = [];
        try {
          const html = fs.readFileSync(filePath, 'utf8');
          const map = parseSeriesEpisodeSources(filePath, html);
          const key = `s${season}e${episode}`;
          sources = map.get(key) || [];
        } catch (_) {
          sources = [];
        }

        const streams = [];
        sources.forEach((src, idx) => {
          const url = String(src?.src || '').trim();
          if (!url) return;
          const isDirect = isDirectMediaUrl(url);
          streams.push({
            name: ADDON_NAME,
            title: String(src?.label || `Servidor ${idx + 1}`),
            ...(isDirect
              ? { url }
              : { externalUrl: url, behaviorHints: { notWebReady: true } }),
          });
        });
        if (!streams.length) {
          const pageUrl = `${baseUrl}/series/${slug}.html?season=${season}&episode=${episode}`;
          streams.push({
            name: ADDON_NAME,
            title: 'Ver en Ultrapelis',
            externalUrl: pageUrl,
            behaviorHints: { notWebReady: true },
          });
        } else if (streams.length < 3) {
          const pageUrl = `${baseUrl}/series/${slug}.html?season=${season}&episode=${episode}`;
          while (streams.length < 3) {
            streams.push({
              name: ADDON_NAME,
              title: `Servidor ${streams.length + 1}`,
              externalUrl: pageUrl,
              behaviorHints: { notWebReady: true },
            });
          }
        }
        return sendJson(res, 200, { streams });
      }

      // --- API Endpoints ---
      if (pathname === '/api/peliculas') {
        maybeSyncMoviesFromHtml();
        return sendJson(res, 200, moviesCache);
      }

      // Endpoint para obtener las películas más recientes.
      if (pathname === '/api/recientes') {
        maybeSyncMoviesFromHtml();
        const limit = Number.parseInt(url.searchParams.get('limit') || '20', 10);
        const rows = getRecentMovies(limit);
        return sendJson(res, 200, rows);
      }

      // Endpoint simple para buscar un trailer en YouTube.
      if (pathname === '/api/youtube-search') {
        const q = url.searchParams.get('q') || '';
        try {
          const ytResp = await fetch(
            `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
          );
          const text = await ytResp.text();
          const m = text.match(/"videoId":"([^"]+)"/);
          const videoId = m ? m[1] : null;
          return sendJson(res, 200, { videoId });
        } catch (err) {
          return sendJson(res, 500, { videoId: null });
        }
      }

      // Endpoint para obtener las películas más populares.
      if (pathname === '/api/populares') {
        maybeSyncMoviesFromHtml();
        const limit = Number.parseInt(url.searchParams.get('limit') || '12', 10);
        const supabaseRows = await fetchSupabaseTopViews('get_top_movie_views', limit);
        if (supabaseRows.length) {
          const seen = new Set();
          const mapped = supabaseRows
            .map((row) => {
              const slug = String(row.slug || '').trim();
              const movie = movieBySlugCache.get(slug);
              if (!movie || !slug) return null;
              seen.add(slug);
              return { ...movie, vistas: Number(row.views || 0) || 0 };
            })
            .filter(Boolean);
          if (mapped.length < limit) {
            const fallback = getPopularMovies(limit)
              .filter((item) => !seen.has(String(item.slug || '').trim()));
            mapped.push(...fallback.slice(0, Math.max(0, limit - mapped.length)));
          }
          return sendJson(res, 200, mapped.slice(0, limit));
        }
        const rows = getPopularMovies(limit);
        return sendJson(res, 200, rows);
      }

      // Endpoint para obtener las series más populares.
      if (pathname === '/api/series/populares') {
        const limit = Number.parseInt(url.searchParams.get('limit') || '12', 10);
        const supabaseRows = await fetchSupabaseTopViews('get_top_series_views', limit);
        const seriesData = loadSeriesData();
        const bySlug = new Map(seriesData.map((item) => [String(item.slug || '').trim(), item]));
        if (supabaseRows.length) {
          const seen = new Set();
          const mapped = supabaseRows
            .map((row) => {
              const slug = String(row.slug || '').trim();
              const serie = bySlug.get(slug);
              if (!serie || !slug) return null;
              seen.add(slug);
              return { ...serie, vistas: Number(row.views || 0) || 0 };
            })
            .filter(Boolean);
          if (mapped.length < limit) {
            const fallback = seriesData.filter((item) => !seen.has(String(item.slug || '').trim()));
            mapped.push(...fallback.slice(0, Math.max(0, limit - mapped.length)));
          }
          return sendJson(res, 200, mapped.slice(0, limit));
        }
        return sendJson(res, 200, seriesData.slice(0, limit));
      }

      // Endpoints para forzar la sincronización de datos.
      if (pathname === '/api/sync/doodstream') {
        const result = syncDoodstreamEmbeds();
        return sendJson(res, 200, {
          ok: true,
          ...result,
        });
      }

      if (pathname === '/api/sync/veo') {
        const result = syncVeoEmbeds();
        return sendJson(res, 200, {
          ok: true,
          ...result,
        });
      }

      if (pathname === '/api/sync/tmdb-images') {
        const result = await syncTmdbImages();
        return sendJson(res, 200, {
          ok: true,
          ...result,
        });
      }

      // Endpoint para obtener los detalles de una película por su slug.
      const movieApiMatch = pathname.match(/^\/api\/peliculas\/([a-z0-9-]+)$/i);
      if (movieApiMatch) {
        maybeSyncMoviesFromHtml();
        const slug = movieApiMatch[1];
        const movie = movieBySlugCache.get(slug);
        if (!movie) return sendJson(res, 404, { error: 'Pelicula no encontrada' });
        return sendJson(res, 200, movie);
      }

      // Endpoint para registrar una vista de una película.
      const movieViewApiMatch = pathname.match(/^\/api\/peliculas\/([a-z0-9-]+)\/view$/i);
      if (movieViewApiMatch) {
        if (method !== 'POST') {
          return sendJson(res, 405, { error: 'Metodo no permitido' });
        }
        maybeSyncMoviesFromHtml();
        const slug = movieViewApiMatch[1];
        const views = await registerMovieView(slug);
        if (views == null) return sendJson(res, 404, { error: 'Pelicula no encontrada' });
        return sendJson(res, 200, { ok: true, slug, views });
      }

      // Endpoint para registrar una vista de una serie.
      const seriesViewApiMatch = pathname.match(/^\/api\/series\/([a-z0-9-]+)\/view$/i);
      if (seriesViewApiMatch) {
        if (method !== 'POST') {
          return sendJson(res, 405, { error: 'Metodo no permitido' });
        }
        const slug = seriesViewApiMatch[1];
        const views = await registerSeriesView(slug);
        if (views == null) return sendJson(res, 404, { error: 'Serie no encontrada' });
        return sendJson(res, 200, { ok: true, slug, views });
      }

      // Sirve la página de inicio.
      if (pathname === '/' || pathname === '/index.html') {
        maybeSyncMoviesFromHtml();
        return send(res, 200, renderedIndexCache, 'text/html; charset=utf-8');
      }

      // Sirve dinámicamente la página de una película si no existe como archivo estático.
      const movieRoute = pathname.match(/^\/peliculas\/([a-z0-9-]+)\/([a-z0-9-]+)\.html$/i);
      if (movieRoute) {
        maybeSyncMoviesFromHtml();
        const categorySlug = movieRoute[1];
        const movieSlug = movieRoute[2];
        const movie = getMovieByCategoryAndSlug(categorySlug, movieSlug);
        if (!movie) return send(res, 404, 'Pelicula no encontrada');
        const html = renderMoviePage(movie);
        const videoInfo = buildVideoInfoFromMovie(movie, baseUrl);
        const jsonLd = buildVideoJsonLd(videoInfo);
        const finalHtml = injectVideoJsonLd(html, jsonLd);
        return send(res, 200, finalHtml, 'text/html; charset=utf-8');
      }

      // Sirve archivos estáticos (CSS, JS, imágenes, etc.).
      if (serveStaticFile(req, pathname, res)) return;

      send(res, 404, 'Not Found');
      })
      .catch((error) => {
        sendJson(res, 500, { error: 'Error interno', detail: error.message });
      });
  });

  server.listen(PORT, HOST, () => {
    console.log(`Ultrapelis backend activo en http://${HOST}:${PORT}`);
    console.log(`Base de datos: ${DB_FILE}`);
    console.log(`Sincronizadas ${synced.movies} peliculas en ${synced.categories} categorias.`);
    console.log(`Doodstream sync: ${doodSync.updated} actualizadas, ${doodSync.missing.length} sin match.`);
    console.log(`Veo sync: ${veoSync.updated} actualizadas, ${veoSync.missing.length} sin match.`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  ensureDatabase,
  syncMoviesFromHtml,
  syncDoodstreamEmbeds,
  syncVeoEmbeds,
  syncTmdbImages,
  refreshCacheFromDatabase,
  getAllMovies,
  getMovieByCategoryAndSlug,
  renderIndexFromTemplate,
  renderMoviePage,
  getRecentMovies,
  getPopularMovies,
  registerMovieView,
  runQuery,
  writeSitemapXml,
  buildSitemapXml,
  writeVideoSitemapXml,
  buildVideoSitemapXml,
  buildVideoInfo,
  buildVideoInfos,
  buildVideoJsonLd,
  buildVideoJsonLds,
  injectVideoJsonLd,
  startServer,
};
