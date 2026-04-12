const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERIES_DIR = path.join(ROOT, 'series');
const TMDB_API_KEY = (process.env.TMDB_API_KEY || '').trim();
const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';

if (!TMDB_API_KEY) {
  console.error('TMDB_API_KEY is required.');
  process.exit(1);
}

const SERIES = [
  { slug: 'mr-robot', title: 'Mr. Robot', year: 2015 },
  { slug: 'dexter', title: 'Dexter', year: 2006 },
  { slug: 'stranger-things', title: 'Stranger Things', year: 2016 },
  { slug: 'hannibal', title: 'Hannibal', year: 2013 },
  { slug: 'house-md', title: 'House M.D.', year: 2004 },
];

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
};

const searchSeries = async (title, year) => {
  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: 'es-MX',
    query: title,
  });
  if (year) params.set('first_air_date_year', String(year));
  const url = `${TMDB_API}/search/tv?${params.toString()}`;
  return fetchJson(url);
};

const pickBest = (title, year, results) => {
  if (!Array.isArray(results) || !results.length) return null;
  const norm = (t) =>
    String(t || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  const target = norm(title);
  let best = results[0];
  let bestScore = -1;
  for (const r of results) {
    const cand = norm(r.name || r.original_name || '');
    let score = 0;
    if (cand === target) score += 3;
    if (cand.includes(target) || target.includes(cand)) score += 2;
    if (year && r.first_air_date) {
      const y = Number(String(r.first_air_date).slice(0, 4)) || 0;
      if (y === year) score += 2;
      if (Math.abs(y - year) === 1) score += 1;
    }
    if (r.poster_path) score += 0.5;
    if (r.backdrop_path) score += 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
};

const getDetails = async (id, lang) => {
  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: lang,
  });
  const url = `${TMDB_API}/tv/${id}?${params.toString()}`;
  return fetchJson(url);
};

const buildSeasons = (count) => {
  const total = Number(count || 0);
  if (!total || total <= 0) return [{ number: 1, episodes: [], rating: 0 }];
  return Array.from({ length: total }, (_, idx) => ({
    number: idx + 1,
    episodes: [],
    rating: 0,
  }));
};

const buildHtml = (slug, title, description, poster, banner, genres, seasonsCount) => {
  const seasonLabel = seasonsCount === 1 ? '1 Temporada' : `${seasonsCount} Temporadas`;
  const heroMeta = `${genres.join(' • ')} • ${seasonLabel}`;
  const data = {
    title,
    genres,
    seasons: buildSeasons(seasonsCount),
  };

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="description" content="${description}"/>
  <meta property="og:title" content="${title} | Ultrapelis"/>
  <meta property="og:image" content="${poster}"/>
  <title>${title} | Ultrapelis</title>

  <link href="../img/favicon.png" rel="icon" type="image/png"/>
  <link href="../style.css?v=20260305" rel="stylesheet"/>
  <link href="../peliculas.css?v=20260305" rel="stylesheet"/>
  <style>
    .hero-movie {
      --movie-bg: url('${banner}'), url('${poster}');
    }
  </style>
  <script id="series-data" type="application/json">
${JSON.stringify(data, null, 2)}
</script>
  <script defer src="../series.js?v=20260307"></script>
</head>
<body data-movie-id="${slug}">
  <header class="topbar">
    <div class="brand">Ultrapelis</div>
    <a class="card-button" href="../index.html">Volver</a>
  </header>

  <main>
    <section class="hero-movie hero">
      <div class="hero-content">
        <p class="hero-kicker">Serie</p>
        <h1 id="series-title">${title}</h1>
        <p class="hero-copy">${heroMeta}</p>
      </div>
    </section>

    <section aria-labelledby="synopsis-title" class="movie-details">
      <h2 id="synopsis-title">Sinopsis</h2>
      <p class="synopsis">${description}</p>
    </section>

    <section aria-labelledby="player-title" class="player">
      <div class="player-header">
        <h2 id="player-title">Temporadas y episodios</h2>
        <p id="player-note">Selecciona una temporada y luego un episodio.</p>
        <p id="season-rating" class="season-rating"></p>
        <p id="series-views" class="season-rating"></p>
      </div>

      <div class="player-servers">
        <div class="player-servers-header">
          <h3>Temporada</h3>
          <p>Elige una temporada disponible.</p>
        </div>
        <select id="season-select" class="season-select"></select>
      </div>

      <div id="episode-list" class="episode-list" role="list"></div>

      <div class="player-servers">
        <div class="player-servers-header">
          <h3>Servidores</h3>
          <p>Selecciona un servidor disponible.</p>
        </div>
        <div id="source-list" class="server-list" role="tablist" aria-label="Servidores"></div>
      </div>

      <div class="player-frame">
        <iframe allow="autoplay; fullscreen; picture-in-picture" allowfullscreen id="player-iframe" src="" title="Reproductor de video"></iframe>
      </div>
    </section>

    <section aria-labelledby="cast-title" class="cast-section">
      <div class="cast-header">
        <h2 id="cast-title">Abrir en Web Video Cast</h2>
        <p>Envia esta serie a la app para reproducirla en tu TV.</p>
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
        <a href="../index.html">Inicio</a>
        <a href="../index.html#catalog">Catalogo</a>
        <a href="mailto:soporteultrapelis@gmail.com">Contacto</a>
      </div>
      <p class="footer-rights">© 2026 Ultrapelis. Todos los derechos reservados.</p>
    </div>
  </footer>
</body>
</html>`;
};

const main = async () => {
  if (!fs.existsSync(SERIES_DIR)) fs.mkdirSync(SERIES_DIR, { recursive: true });

  for (const item of SERIES) {
    const search = await searchSeries(item.title, item.year);
    if (!search || !Array.isArray(search.results) || !search.results.length) {
      console.error(`No TMDB results for ${item.title}`);
      continue;
    }
    const best = pickBest(item.title, item.year, search.results);
    if (!best || !best.id) {
      console.error(`No TMDB match for ${item.title}`);
      continue;
    }

    const detailsEs = await getDetails(best.id, 'es-MX');
    const detailsEn = await getDetails(best.id, 'en-US');
    const details = detailsEs || detailsEn || best;

    const title = details.name || best.name || item.title;
    const overview = details.overview || 'Sinopsis no disponible.';
    const posterPath = details.poster_path || best.poster_path || '';
    const bannerPath = details.backdrop_path || best.backdrop_path || '';
    const posterUrl = posterPath ? `${TMDB_IMG}/w500${posterPath}` : 'https://image.tmdb.org/t/p/w500/5OKwDsJrsjOVgQLnXW6HYEOUolz.jpg';
    const bannerUrl = bannerPath ? `${TMDB_IMG}/original${bannerPath}` : posterUrl;
    const genres = Array.isArray(details.genres) && details.genres.length
      ? details.genres.map((g) => g.name).filter(Boolean)
      : ['Serie'];
    const seasonsCount = Number(details.number_of_seasons || 1);

    const description = `Mira ${title} en Ultrapelis. Temporadas y episodios disponibles.`;
    const html = buildHtml(item.slug, title, overview, posterUrl, bannerUrl, genres, seasonsCount);
    const outPath = path.join(SERIES_DIR, `${item.slug}.html`);
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`OK: ${outPath}`);
    await new Promise((r) => setTimeout(r, 150));
  }
};

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
