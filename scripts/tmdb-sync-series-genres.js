const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERIES_DIR = path.join(ROOT, 'series');
const TMDB_API_KEY = (process.env.TMDB_API_KEY || '').trim();
const TMDB_API = 'https://api.themoviedb.org/3';

if (!TMDB_API_KEY) {
  console.error('TMDB_API_KEY is required.');
  process.exit(1);
}

const SERIES_DATA_REGEX = /<script[^>]*id=["']series-data["'][^>]*>([\s\S]*?)<\/script>/i;

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
};

const normalize = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const mapGenreList = (genres) => {
  const mapped = [];
  const add = (value) => {
    const text = String(value || '').trim();
    if (!text) return;
    if (!mapped.includes(text)) mapped.push(text);
  };

  for (const raw of genres || []) {
    const key = normalize(raw);
    if (!key) continue;
    if (key.includes('accion') && key.includes('aventura')) {
      add('Accion');
      add('Aventura');
      continue;
    }
    if (key.includes('ciencia') && key.includes('fantasia')) {
      add('Ciencia ficcion');
      add('Fantasia');
      continue;
    }
    if (key.includes('ciencia ficcion')) {
      add('Ciencia ficcion');
      continue;
    }
    if (key.includes('fantasia')) {
      add('Fantasia');
      continue;
    }
    if (key.includes('misterio')) {
      add('Misterio');
      continue;
    }
    if (key.includes('crimen')) {
      add('Crimen');
      continue;
    }
    if (key.includes('drama')) {
      add('Drama');
      continue;
    }
    if (key.includes('comedia')) {
      add('Comedia');
      continue;
    }
    if (key.includes('romance')) {
      add('Romance');
      continue;
    }
    if (key.includes('terror') || key.includes('horror')) {
      add('Terror');
      continue;
    }
    if (key.includes('thriller')) {
      add('Thriller');
      continue;
    }
    if (key.includes('animacion')) {
      add('Animacion');
      continue;
    }
    if (key.includes('familia')) {
      add('Familiar');
      continue;
    }
    if (key.includes('musical') || key.includes('musica')) {
      add('Musical');
      continue;
    }
    if (key.includes('guerra') || key.includes('politica')) {
      add('Drama');
      continue;
    }
    if (key.includes('documental')) {
      add('Biografica');
      continue;
    }
  }

  if (!mapped.length) return ['Serie'];
  return mapped;
};

const buildHeroCopy = (genres, seasonsCount) => {
  const seasonLabel = seasonsCount === 1 ? '1 Temporada' : `${seasonsCount} Temporadas`;
  const list = genres.length ? genres.join(' • ') : 'Serie';
  return `${list} • ${seasonLabel}`;
};

const readSeriesData = (html) => {
  const match = html.match(SERIES_DATA_REGEX);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    return { data, raw: match[1] };
  } catch (_) {
    return null;
  }
};

const writeSeriesData = (html, data) => {
  const json = JSON.stringify(data, null, 2);
  return html.replace(SERIES_DATA_REGEX, (full, captured) => {
    return full.replace(captured, `\n${json}\n`);
  });
};

const updateHeroCopy = (html, copyText) => {
  return html.replace(/(<p class="hero-copy">)([\s\S]*?)(<\/p>)/i, `$1${copyText}$3`);
};

const findTitle = (html, data) => {
  if (data && data.title) return String(data.title).trim();
  const h1 = html.match(/<h1[^>]*id=["']series-title["'][^>]*>\s*([\s\S]*?)\s*<\/h1>/i);
  if (h1 && h1[1]) return h1[1].trim();
  return '';
};

const searchSeries = async (title) => {
  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: 'es-MX',
    query: title,
  });
  const url = `${TMDB_API}/search/tv?${params.toString()}`;
  return fetchJson(url);
};

const pickBest = (title, results) => {
  if (!Array.isArray(results) || !results.length) return null;
  const target = normalize(title);
  let best = results[0];
  let bestScore = -1;
  for (const r of results) {
    const cand = normalize(r.name || r.original_name || '');
    let score = 0;
    if (cand === target) score += 3;
    if (cand.includes(target) || target.includes(cand)) score += 2;
    if (r.poster_path) score += 0.5;
    if (r.backdrop_path) score += 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
};

const getDetails = async (id) => {
  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: 'es-MX',
  });
  const url = `${TMDB_API}/tv/${id}?${params.toString()}`;
  return fetchJson(url);
};

const walkHtml = (dir) => {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) continue;
    if (name.endsWith('.html')) out.push(full);
  }
  return out;
};

const main = async () => {
  const files = walkHtml(SERIES_DIR);
  let updated = 0;
  for (const filePath of files) {
    let html = fs.readFileSync(filePath, 'utf8');
    const parsed = readSeriesData(html);
    if (!parsed) continue;
    const title = findTitle(html, parsed.data);
    if (!title) continue;

    const search = await searchSeries(title);
    if (!search || !Array.isArray(search.results) || !search.results.length) continue;
    const best = pickBest(title, search.results);
    if (!best || !best.id) continue;

    const details = await getDetails(best.id);
    if (!details || !Array.isArray(details.genres)) continue;

    const mappedGenres = mapGenreList(details.genres.map((g) => g.name));
    parsed.data.genres = mappedGenres;
    const seasonsCount = Array.isArray(parsed.data.seasons) ? parsed.data.seasons.length : 0;
    const heroCopy = buildHeroCopy(mappedGenres, seasonsCount || 1);

    html = writeSeriesData(html, parsed.data);
    html = updateHeroCopy(html, heroCopy);
    fs.writeFileSync(filePath, html, 'utf8');
    updated += 1;
    await new Promise((r) => setTimeout(r, 140));
  }

  console.log(`Series actualizadas: ${updated}`);
};

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
