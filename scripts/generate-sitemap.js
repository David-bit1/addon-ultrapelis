const { writeSitemapXml, writeVideoSitemapXml } = require('../server');

try {
  const result = writeSitemapXml();
  console.log(`Sitemap generado: ${result.file} (${result.count} URLs)`);
  const videoResult = writeVideoSitemapXml();
  console.log(`Sitemap de video generado: ${videoResult.file} (${videoResult.count} URLs)`);
} catch (error) {
  console.error(`No se pudo generar sitemap: ${error.message}`);
  process.exit(1);
}
