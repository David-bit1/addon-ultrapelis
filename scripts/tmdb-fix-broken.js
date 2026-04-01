const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'ultrapelis.db');
const API_KEY = (process.env.TMDB_API_KEY || '').trim();
const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';

if (!API_KEY) {
  console.error('Missing TMDB_API_KEY');
  process.exit(1);
}

const OVERRIDES = {
  'spider-man-3-2007': { title: 'Spider-Man 3', year: 2007 },
  'the-amazing-spider-man-2-2014': { title: 'The Amazing Spider-Man 2', year: 2014 },
  'the-incredible-hulk-2008': { title: 'The Incredible Hulk', year: 2008 },
  'hulk-2003': { title: 'Hulk', year: 2003 },
  'spider-man-homecoming-2017': { title: 'Spider-Man: Homecoming', year: 2017 },
  'inside-out-2': { title: 'IntensaMente 2', year: 2024 },
  'good-boy': { title: 'Good Boy', year: 2025 },
};

// Lista de películas que no deben ser tocadas por el script automático de TMDB
const MANUAL_ONLY_SLUGS = [
  'peaky-blinders-el-hombre-inmortal-2026'
];

function runQuery(sql) {
  const exec = spawnSync('sqlite3', ['-json', DB_FILE, sql], { encoding: 'utf8' });
  if (exec.status !== 0) {
    throw new Error(exec.stderr || exec.stdout || 'SQLite error');
  }
  const out = (exec.stdout || '').trim();
  return out ? JSON.parse(out) : [];
}

function runExec(sql) {
  const exec = spawnSync('sqlite3', [DB_FILE, sql], { encoding: 'utf8' });
  if (exec.status !== 0) {
    throw new Error(exec.stderr || exec.stdout || 'SQLite error');
  }
}

function sqlValue(value) {
  if (value == null) return 'NULL';
  const text = String(value).trim();
  if (!text) return 'NULL';
  return `'${text.replace(/'/g, "''")}'`;
}

function parseYear(text) {
  if (!text) return 0;
  const match = String(text).match(/(19\d{2}|20\d{2})/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function normalizeTitle(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function scoreMatch(targetTitle, targetYear, candidate) {
  const candTitle = normalizeTitle(candidate.title || '');
  const candOrig = normalizeTitle(candidate.original_title || '');
  const target = normalizeTitle(targetTitle || '');
  if (!candTitle && !candOrig) return 0;
  let score = 0;

  const exact = target === candTitle || target === candOrig;
  const contains =
    (candTitle && candTitle.includes(target)) ||
    (candOrig && candOrig.includes(target)) ||
    (target && (target.includes(candTitle) || target.includes(candOrig)));

  if (exact) score += 3;
  if (!exact && contains) score += 2;

  if (targetYear && candidate.release_date) {
    const year = parseYear(candidate.release_date);
    if (year === targetYear) score += 2;
    else if (Math.abs(year - targetYear) === 1) score += 1;
  }

  if (candidate.poster_path) score += 0.5;
  if (candidate.backdrop_path) score += 0.25;

  return score;
}

async function searchMovie(title, year) {
  const params = new URLSearchParams({
    api_key: API_KEY,
    language: 'es-MX',
    query: title,
  });
  if (year) params.set('year', String(year));
  const url = `${TMDB_API}/search/movie?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !Array.isArray(data.results) || data.results.length === 0) return null;
  return data.results;
}

async function headOk(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    return ct.startsWith('image/');
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (!fs.existsSync(DB_FILE)) {
    console.error('DB not found:', DB_FILE);
    process.exit(1);
  }

  const movies = runQuery(`
    SELECT id, titulo, slug, estreno_texto, poster_url, banner_url
    FROM peliculas
    ORDER BY titulo COLLATE NOCASE ASC;
  `);

  const updates = [];
  let updated = 0;

  for (const movie of movies) {
    if (MANUAL_ONLY_SLUGS.includes(String(movie.slug).trim())) continue;

    const override = OVERRIDES[String(movie.slug || '').trim()] || null;
    const title = override ? override.title : String(movie.titulo || '').trim();
    if (!title) continue;
    const year = override && override.year ? override.year : parseYear(movie.estreno_texto);

    const posterOk = await headOk(String(movie.poster_url || ''));
    const bannerOk = await headOk(String(movie.banner_url || ''));
    if (posterOk && bannerOk) continue;

    let results = await searchMovie(title, year);
    if (!results) {
      const normalized = normalizeTitle(title);
      if (normalized && normalized !== title) {
        results = await searchMovie(normalized, year);
      }
    }
    if (!results && title.includes(':')) {
      const shortTitle = title.split(':')[0].trim();
      if (shortTitle) {
        results = await searchMovie(shortTitle, year);
      }
    }
    if (!results || !results.length) continue;

    let best = null;
    let bestScore = -1;
    for (const cand of results) {
      const score = scoreMatch(title, year, cand);
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    if (!best || bestScore < 2) continue;

    const posterPath = best.poster_path ? `${TMDB_IMG}/w500${best.poster_path}` : '';
    const bannerPath = best.backdrop_path ? `${TMDB_IMG}/original${best.backdrop_path}` : '';

    const sqlLines = [];
    if (posterPath) sqlLines.push(`poster_url=${sqlValue(posterPath)}`);
    if (bannerPath) sqlLines.push(`banner_url=${sqlValue(bannerPath)}`);
    if (!sqlLines.length) continue;

    updates.push(`UPDATE peliculas SET ${sqlLines.join(', ')} WHERE id=${Number(movie.id)};`);
    updated += 1;

    await new Promise((r) => setTimeout(r, 120));
  }

  if (updates.length) {
    runExec('BEGIN TRANSACTION;\n' + updates.join('\n') + '\nCOMMIT;');
  }

  console.log(`Updated ${updated} movies via TMDB (broken posters/banners).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
