// Baut die Handy-App zu einer einzigen HTML-Datei.
//
//   node scripts/build-app.ts
//   APP_VARIANT=vorschau node scripts/build-app.ts   Vorschau-Fassung mit eigenem Namen und Hinweis in der Kopfzeile,
//                                                    damit man sie auf dem Handy nicht mit der Live-Fassung verwechselt
//
// Ergebnis in dist/:
//   index.html          vollständige Seite für einen normalen Webserver (z. B. GitHub Pages): holt live bei Open-Meteo
//   artifact.html       dieselbe App ohne Dokumentgerüst, zum Veröffentlichen als Claude-Artifact
//   data/forecast.json  mitgelieferter Datenstand (neueste Datei aus fixtures/), falls kein Live-Abruf möglich ist
//   manifest.webmanifest, icons/   damit man die Web-Fassung als Icon auf den Startbildschirm legen kann
//   .nojekyll           GitHub Pages soll die Dateien unverändert ausliefern

import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist');
mkdirSync(join(out, 'data'), { recursive: true });
mkdirSync(join(out, 'icons'), { recursive: true });

const pilot = readFileSync(join(root, 'config/pilot-standard.json'), 'utf8');
const result = await build({
  entryPoints: [join(root, 'app/main.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020', 'safari14'],
  write: false,
  legalComments: 'none',
  define: { __DEFAULT_PILOT__: JSON.stringify(JSON.parse(pilot)) },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(root, 'app/style.css'), 'utf8');

const fonts = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Semi+Condensed:wght@500;600;700&display=swap">',
].join('\n');

const DESCRIPTION = 'Flugfenster an Schwarzwald-Startplätzen, bewertet nach deinem Pilotenprofil.';
const preview = (process.env.APP_VARIANT ?? '') !== '';
const APP_NAME = preview ? 'Flugwetter Vorschau' : 'Flugwetter für mich';
const SHORT_NAME = preview ? 'FW Vorschau' : 'Flugwetter';
const badge = preview ? '\n    <p class="badge">Vorschau, nicht die Live-App</p>' : '';

const body = `<header class="top">
  <div class="wrap">${badge}
    <div class="brand">
      <h1>Flugwetter für mich</h1>
      <button class="refresh" id="refresh" type="button">Aktualisieren</button>
    </div>
    <div class="status" id="status" role="status">Lade Vorhersage …</div>
    <nav class="tabs" aria-label="Ansichten">
      <a href="#fenster" id="tab-fenster" aria-current="page">Flugfenster</a>
      <a href="#profil" id="tab-profil">Profil</a>
      <a href="#info" id="tab-info">Info</a>
    </nav>
  </div>
</header>
<main>
  <div class="wrap" id="view"><p class="empty">Lade Vorhersage …</p></div>
</main>`;

const artifact = `<title>${APP_NAME}</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>
${css}
</style>
${body}
<script>
${js}
</script>
`;

const web = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#eef2ef" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1513" media="(prefers-color-scheme: dark)">
<meta name="description" content="${DESCRIPTION}">
<title>${APP_NAME}</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="icon" href="icons/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${SHORT_NAME}">
${fonts}
<style>
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; }
${css}
</style>
</head>
<body>
${body}
<script>
${js}
</script>
</body>
</html>
`;

writeFileSync(join(out, 'artifact.html'), artifact);
writeFileSync(join(out, 'index.html'), web);

const manifest = {
  name: APP_NAME,
  short_name: SHORT_NAME,
  description: DESCRIPTION,
  lang: 'de',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#eef2ef',
  theme_color: '#eef2ef',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
};
writeFileSync(join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
for (const f of readdirSync(join(root, 'app/icons'))) copyFileSync(join(root, 'app/icons', f), join(out, 'icons', f));
writeFileSync(join(out, '.nojekyll'), '');

const fixtures = readdirSync(join(root, 'fixtures')).filter((f) => f.startsWith('openmeteo_')).sort();
const newest = fixtures[fixtures.length - 1];
copyFileSync(join(root, 'fixtures', newest), join(out, 'data/forecast.json'));

if (preview) console.log(`Vorschau-Fassung (${process.env.APP_VARIANT})`);
console.log(`dist/artifact.html ${(artifact.length / 1024).toFixed(0)} KB, dist/index.html ${(web.length / 1024).toFixed(0)} KB`);
console.log(`dist/data/forecast.json aus fixtures/${newest}`);
