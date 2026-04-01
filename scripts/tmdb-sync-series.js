const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERIES_FILE = path.join(ROOT, 'data', 'series.json');
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

if (!TMDB_API_KEY) {
  console.error('TMDB_API_KEY is required.');
  process.exit(1);
}

const readJson = (filePath) => {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const writeJson = (filePath, data) => {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
};

const buildUrl = (title, year) => {
  const query = encodeURIComponent(title);
  const yearParam = year ? `&first_air_date_year=${encodeURIComponent(year)}` : '';
  return `${TMDB_API_BASE}/search/tv?api_key=${TMDB_API_KEY}&query=${query}${yearParam}`;
};

const pickBest = (results) => {
  if (!Array.isArray(results) || !results.length) return null;
  return results[0];
};

const updateSeriesHtml = (slug, posterUrl, bannerUrl) => {
  const htmlPath = path.join(ROOT, 'series', `${slug}.html`);
  if (!fs.existsSync(htmlPath)) return;
  let html = fs.readFileSync(htmlPath, 'utf8');
  if (posterUrl) {
    html = html.replace(/(<meta[^>]*property=["']og:image["'][^>]*content=["'])([^"']*)(["'][^>]*>)/i, `$1${posterUrl}$3`);
    html = html.replace(/(<meta[^>]*name=["']twitter:image["'][^>]*content=["'])([^"']*)(["'][^>]*>)/i, `$1${posterUrl}$3`);
  }
  if (bannerUrl) {
    html = html.replace(/(class=\"hero-movie hero\" style=\"--movie-bg: url\(')([^']*)('\)\;\")/i, `$1${bannerUrl}$3`);
  }
  fs.writeFileSync(htmlPath, html, 'utf8');
};

(async () => {
  const series = readJson(SERIES_FILE);
  let updated = 0;

  for (const item of series) {
    if (!item || !item.title) continue;
    const url = buildUrl(item.title, item.year);
    let data;
    try {
      data = await fetchJson(url);
    } catch (err) {
      console.error(`TMDB fetch failed for ${item.title}:`, err.message);
      continue;
    }
    const best = pickBest(data.results);
    if (!best) continue;

    const posterPath = best.poster_path;
    const backdropPath = best.backdrop_path;
    const posterUrl = posterPath ? `${TMDB_IMAGE_BASE}/w500${posterPath}` : '';
    const bannerUrl = backdropPath ? `${TMDB_IMAGE_BASE}/original${backdropPath}` : '';

    if (posterUrl) item.poster = posterUrl;
    if (bannerUrl) item.banner = bannerUrl;
    updateSeriesHtml(item.slug, item.poster, item.banner || item.poster);
    updated += 1;
  }

  writeJson(SERIES_FILE, series);
  console.log(`Series updated: ${updated}`);
})();
