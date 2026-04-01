/**
 * Este script busca trailers en YouTube para cada película y agrega un botón "Trailer"
 * a la lista de servidores en el archivo HTML correspondiente.
 * Busca el título de la película en el HTML, realiza una búsqueda en YouTube y extrae el ID del primer video.
 */
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

async function searchTrailer(title) {
  const q = encodeURIComponent(title + ' trailer');
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${q}`
    );
    const txt = await res.text();
    const m = txt.match(/"videoId":"([^"]+)"/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

async function processFile(file) {
  const html = fs.readFileSync(file, 'utf8');
  // Se revisa de forma más robusta si ya existe un botón de trailer para no duplicarlo.
  if (/<button[^>]*data-trailer="true"[^>]*>Trailer<\/button>/i.test(html)) {
    return;
  }
  const m = html.match(/<h1[^>]*id=["']movie-title["'][^>]*>([^<]+)</i);
  const title = m ? m[1].trim() : null;
  if (!title) return;
  const id = await searchTrailer(title);
  console.log('Procesando:', path.basename(file), '| Título:', title, '| ID de video:', id);
  if (id) {
    // Se agrega el botón al final de la lista de servidores y se añade `data-trailer="true"`
    // para ser consistente con el script `movie.js` que lo agrega dinámicamente.
    const newHtml = html.replace(
      /(<div[^>]+class="server-list"[^>]*>[\s\S]*?)(<\/div>)/,
      `$1\n      <button class="server-btn" data-src="https://www.youtube.com/embed/${id}" type="button" data-trailer="true">Trailer</button>\n    $2`
    );
    // Solo se escribe el archivo si hubo un cambio.
    if (newHtml !== html) fs.writeFileSync(file, newHtml, 'utf8');
  }
}

async function main() {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.html')) files.push(p);
    }
  }
  walk(path.join(__dirname, 'peliculas'));
  for (const f of files) {
    await processFile(f);
  }
}

main().catch(console.error);
