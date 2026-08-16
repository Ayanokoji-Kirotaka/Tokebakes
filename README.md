# Toke Bakes

Static site for Toke Bakes — artisan cakes, cupcakes, and pastries.

What this repo contains
- Static HTML, CSS, and JS for the Toke Bakes website.
- Images are organized under `images/logos`, `images/icons`, and `images/previews`.
- Progressive Web App support via `manifest.json` and service worker registration.

Local development

Quick local server (Python):

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

Or using Node (if you have `http-server`):

```bash
npm install -g http-server
http-server -c-1
```

Notes
- `robots.txt` now uses a relative `Sitemap: /sitemap.xml` entry for portability.
- `sitemap.xml` has been regenerated to include the site's HTML pages.
- `manifest.json` contains the app metadata and references icons in `images/icons/`.

If you want, I can also create a short CONTRIBUTING or deployment section for the README.
