const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MOVIES_DIR = path.join(ROOT, 'peliculas');
const TMDB_API_KEY = (process.env.TMDB_API_KEY || '').trim();
const TMDB_API_BASE = 'https://api.themoviedb.org/3';

if (!TMDB_API_KEY) {
  console.error('TMDB_API_KEY is required.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const normalizeText = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const formatDateEs = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  const day = date.getUTCDate();
  const month = months[date.getUTCMonth()] || '';
  const year = date.getUTCFullYear();
  if (!day || !month || !year) return '';
  return `${day} de ${month} de ${year}`;
};

const formatRuntime = (minutes) => {
  const total = Number(minutes || 0);
  if (!total || total <= 0) return '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
};

const walkHtmlFiles = (dir) => {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      out.push(...walkHtmlFiles(full));
    } else if (name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
};

const extractTitle = (html, filePath) => {
  const h1 = html.match(/<h1[^>]*id=["']movie-title["'][^>]*>\s*([\s\S]*?)\s*<\/h1>/i);
  if (h1 && h1[1]) return h1[1].trim();
  const title = html.match(/<title>\s*([\s\S]*?)\s*\|\s*Ultrapelis\s*<\/title>/i);
  if (title && title[1]) return title[1].trim();
  return path.basename(filePath, '.html');
};

const replaceInfo = (html, label, value) => {
  if (!value) return html;
  const regex = new RegExp(
    `(<h3>\\s*${label}\\s*<\\/h3>\\s*<p>)([^<]*)(<\\/p>)`,
    'i'
  );
  const match = html.match(regex);
  if (!match) return html;
  const current = String(match[2] || '').trim().toLowerCase();
  if (current !== 'por definir' && current !== 'n/d') return html;
  return html.replace(regex, `$1${value}$3`);
};

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
};

const searchMovie = async (title) => {
  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: 'es-MX',
    query: title,
  });
  const url = `${TMDB_API_BASE}/search/movie?${params.toString()}`;
  return fetchJson(url);
};

const pickBest = (title, results) => {
  if (!Array.isArray(results) || !results.length) return null;
  const target = normalizeText(title);
  let best = results[0];
  let bestScore = -1;
  for (const item of results) {
    const cand = normalizeText(item.title || item.original_title || '');
    if (!cand) continue;
    let score = 0;
    if (cand === target) score += 3;
    if (cand.includes(target) || target.includes(cand)) score += 2;
    if (item.poster_path) score += 0.5;
    if (item.backdrop_path) score += 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= 2 ? best : results[0];
};

const getDetails = async (id) => {
  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: 'es-MX',
  });
  const url = `${TMDB_API_BASE}/movie/${id}?${params.toString()}`;
  return fetchJson(url);
};

const getCredits = async (id) => {
  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: 'es-MX',
  });
  const url = `${TMDB_API_BASE}/movie/${id}/credits?${params.toString()}`;
  return fetchJson(url);
};

const main = async () => {
  const files = walkHtmlFiles(MOVIES_DIR);
  let updated = 0;

  for (const filePath of files) {
    let html = fs.readFileSync(filePath, 'utf8');
    if (!/Por definir/i.test(html)) continue;

    const title = extractTitle(html, filePath);
    if (!title) continue;

    const search = await searchMovie(title);
    if (!search || !Array.isArray(search.results) || !search.results.length) continue;
    const best = pickBest(title, search.results);
    if (!best || !best.id) continue;

    const details = await getDetails(best.id);
    const credits = await getCredits(best.id);

    const director =
      credits && Array.isArray(credits.crew)
        ? (credits.crew.find((c) => c.job === 'Director') || credits.crew.find((c) => c.department === 'Directing'))
        : null;
    const directorName = director ? director.name : '';

    const castNames =
      credits && Array.isArray(credits.cast)
        ? credits.cast.slice(0, 6).map((c) => c.name).filter(Boolean).join(', ')
        : '';

    const release = details ? formatDateEs(details.release_date) : '';
    const runtime = details ? formatRuntime(details.runtime) : '';

    const nextHtml = [ 
      ['Director', directorName],
      ['Reparto principal', castNames],
      ['Estreno', release],
      ['Duracion', runtime],
    ].reduce((acc, [label, value]) => replaceInfo(acc, label, value), html);

    if (nextHtml !== html) {
      fs.writeFileSync(filePath, nextHtml, 'utf8');
      updated += 1;
      await sleep(120);
    }
  }

  console.log(`Peliculas actualizadas: ${updated}`);
};

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
