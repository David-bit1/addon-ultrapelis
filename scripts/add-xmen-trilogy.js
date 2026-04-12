const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'peliculas', 'superheroes');
const TMDB_API_KEY = (process.env.TMDB_API_KEY || '').trim();
const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';

if (!TMDB_API_KEY) {
  console.error('TMDB_API_KEY is required.');
  process.exit(1);
}

const MOVIES = [
  { slug: 'x-men-2000', title: 'X-Men', year: 2000, displayTitle: 'X-Men (2000)' },
  { slug: 'x-men-2-2003', title: 'X-Men 2', year: 2003, displayTitle: 'X-Men 2 (2003)' },
  { slug: 'x-men-the-last-stand-2006', title: 'X-Men: The Last Stand', year: 2006, displayTitle: 'X-Men: La decision final (2006)' },
];

const formatDateEs = (iso) => {
  if (!iso) return 'N/D';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'N/D';
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  const day = date.getUTCDate();
  const month = months[date.getUTCMonth()] || '';
  const year = date.getUTCFullYear();
  if (!day || !month || !year) return 'N/D';
  return `${day} de ${month} de ${year}`;
};

const formatRuntime = (minutes) => {
  const total = Number(minutes || 0);
  if (!total || total <= 0) return 'N/D';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

const fetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
};

const searchMovie = async (title, year) => {
  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: 'es-MX',
    query: title,
  });
  if (year) params.set('year', String(year));
  const url = `${TMDB_API}/search/movie?${params.toString()}`;
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
    const cand = norm(r.title || r.original_title || '');
    let score = 0;
    if (cand === target) score += 3;
    if (cand.includes(target) || target.includes(cand)) score += 2;
    if (year && r.release_date) {
      const y = Number(String(r.release_date).slice(0, 4)) || 0;
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
  const url = `${TMDB_API}/movie/${id}?${params.toString()}`;
  return fetchJson(url);
};

const getCredits = async (id) => {
  const params = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: 'es-MX',
  });
  const url = `${TMDB_API}/movie/${id}/credits?${params.toString()}`;
  return fetchJson(url);
};

const buildHtml = (movie, data) => {
  const poster = data.posterUrl || 'https://image.tmdb.org/t/p/w500/5OKwDsJrsjOVgQLnXW6HYEOUolz.jpg';
  const banner = data.bannerUrl || poster;
  const title = movie.displayTitle;
  const description = `Mira ${title} en Ultrapelis. Consulta ficha tecnica, sinopsis y opciones para ver la pelicula en linea.`;
  const synopsis = data.overview || 'Sinopsis no disponible.';
  const duration = data.runtime || 'N/D';
  const rating = data.rating || 'N/D';
  const director = data.director || 'N/D';
  const cast = data.cast || 'N/D';
  const release = data.release || 'N/D';
  const idioma = 'Espanol (Latino)';

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
      .info-grid { grid-template-columns: 1fr; }
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
<body data-movie-id="${movie.slug}">
  <header class="topbar">
    <div class="brand">Ultrapelis</div>
    <a class="card-button" href="../../index.html">Volver</a>
  </header>
  <main>
    <section aria-labelledby="movie-title" class="hero-movie hero" style="--movie-bg: url('${banner}'), url('${poster}');">
      <div class="hero-content">
        <p class="hero-kicker">Pelicula</p>
        <h1 id="movie-title">${title}</h1>
        <p class="hero-copy">Superheroes • ${duration}</p>
      </div>
    </section>

    <section aria-labelledby="details-title" class="movie-details">
      <h2 id="details-title">Ficha tecnica</h2>
      <div class="info-grid">
        <div class="info-card"><h3>Director</h3><p>${director}</p></div>
        <div class="info-card"><h3>Reparto principal</h3><p>${cast}</p></div>
        <div class="info-card"><h3>Estreno</h3><p>${release}</p></div>
        <div class="info-card"><h3>Duracion</h3><p>${duration}</p></div>
        <div class="info-card"><h3>Idiomas</h3><p>${idioma}</p></div>
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
        <button class="server-btn is-active" data-src="" type="button">Espanol (Latino)</button>
        <button class="server-btn" data-src="" type="button">Espanol (Latino 2)</button>
        <button class="server-btn" data-src="" type="button">Espanol (Latino 3)</button>
      </div>
      <div class="player-frame">
        <iframe allow="autoplay; fullscreen; picture-in-picture" allowfullscreen id="player-iframe" src="" title="Reproductor de video"></iframe>
      </div>
    </section>

    <section aria-labelledby="cast-title" class="cast-section">
      <div class="cast-header">
        <h2 id="cast-title">Abrir en Web Video Cast</h2>
        <p>Envia esta pelicula a la app para reproducirla en tu TV.</p>
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
        <a href="mailto:soporteultrapelis@gmail.com">Contacto</a>
      </div>
      <p class="footer-rights">© 2026 Ultrapelis. Todos los derechos reservados.</p>
    </div>
  </footer>
</body>
</html>`;
};

const main = async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const movie of MOVIES) {
    const search = await searchMovie(movie.title, movie.year);
    if (!search || !Array.isArray(search.results) || !search.results.length) {
      console.error(`No TMDB results for ${movie.title}`);
      continue;
    }
    const best = pickBest(movie.title, movie.year, search.results);
    if (!best || !best.id) {
      console.error(`No TMDB match for ${movie.title}`);
      continue;
    }

    const detailsEs = await getDetails(best.id, 'es-MX');
    const detailsEn = await getDetails(best.id, 'en-US');
    const credits = await getCredits(best.id);

    const overview = (detailsEs && detailsEs.overview) || (detailsEn && detailsEn.overview) || '';
    const runtime = detailsEs?.runtime || detailsEn?.runtime || 0;
    const releaseDate = detailsEs?.release_date || detailsEn?.release_date || '';
    const rating = detailsEs?.vote_average || detailsEn?.vote_average || 0;

    const director =
      credits && Array.isArray(credits.crew)
        ? (credits.crew.find((c) => c.job === 'Director') || credits.crew.find((c) => c.department === 'Directing'))
        : null;
    const castNames =
      credits && Array.isArray(credits.cast)
        ? credits.cast.slice(0, 6).map((c) => c.name).filter(Boolean).join(', ')
        : '';

    const posterPath = detailsEs?.poster_path || detailsEn?.poster_path || best.poster_path || '';
    const bannerPath = detailsEs?.backdrop_path || detailsEn?.backdrop_path || best.backdrop_path || '';
    const posterUrl = posterPath ? `${TMDB_IMG}/w500${posterPath}` : '';
    const bannerUrl = bannerPath ? `${TMDB_IMG}/original${bannerPath}` : '';

    const data = {
      overview: overview || 'Sinopsis no disponible.',
      runtime: formatRuntime(runtime),
      release: formatDateEs(releaseDate),
      rating: rating ? `${Number(rating).toFixed(1)}/10` : 'N/D',
      director: director ? director.name : 'N/D',
      cast: castNames || 'N/D',
      posterUrl,
      bannerUrl,
    };

    const html = buildHtml(movie, data);
    const outPath = path.join(OUT_DIR, `${movie.slug}.html`);
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(`OK: ${outPath}`);
    await new Promise((r) => setTimeout(r, 150));
  }
};

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
