const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MOVIES_DIR = path.join(ROOT, 'peliculas');

// Funciones auxiliares para encontrar y parsear archivos.
// Son una versión simplificada de las que están en server.js.

function walkMovieHtmlFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      out.push(...walkMovieHtmlFiles(full));
    } else if (name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function matchFirst(html, pattern) {
  const found = html.match(pattern);
  return found && found[1] ? found[1].trim() : '';
}

// Función principal que revisa los archivos.

function checkMovieFiles() {
  const files = walkMovieHtmlFiles(MOVIES_DIR);
  const moviesWithoutLink = [];

  console.log(`\nRevisando ${files.length} archivos de películas...`);

  for (const filePath of files) {
    const html = fs.readFileSync(filePath, 'utf8');
    const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
    const embedUrl = matchFirst(html, /<button[^>]*class="server-btn is-active"[^>]*data-src="([^"]*)"/i);

    if (!embedUrl || embedUrl.includes('no-video.html')) {
      const title = matchFirst(html, /<h1[^>]*id=["']movie-title["'][^>]*>([^<]+)</i) || path.basename(filePath, '.html');
      moviesWithoutLink.push({ title, path: relPath });
    }
  }

  console.log('--------------------------------------------------');
  if (moviesWithoutLink.length > 0) {
    console.log(`Se encontraron ${moviesWithoutLink.length} películas sin enlace de video principal (el trailer no cuenta):`);
    moviesWithoutLink.forEach(movie => console.log(`- Título: ${movie.title}\n  Archivo: ${movie.path}\n`));
  } else {
    console.log('¡Excelente! Todas las películas tienen un enlace de video en el servidor principal.');
  }
  console.log('--------------------------------------------------');
}

checkMovieFiles();