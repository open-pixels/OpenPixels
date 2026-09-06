# Deploying OpenPixels

Two hostnames on one host (`104.36.65.54`), and they are different things:

| | | |
|---|---|---|
| `openpixels.app` | `/var/www/openpixels-site` | The marketing site: `website/` in this repo. |
| `app.openpixels.app` | `/var/www/openpixels-app` | The application: `apps/web/dist`. |
| `www.openpixels.app` | — | Redirects to the apex. |

Both are static files and nothing else. There is no server process, no
database and no API — which is the same fact the About page and the privacy
policy state, so **any deployment that adds one has broken the product's
central claim.**

## Build

```sh
npm --prefix apps/web install
npm --prefix apps/web run build      # -> apps/web/dist  (~544 MB, 505 MB of it models)
```

The build fetches and checksums the weights on first run. It needs Python
with `torch`, `onnx`, `onnxruntime` and `onnxconverter-common` for the
conversion step, once — after that `.vendor/models` is cached and the
checksums short-circuit it.

## Publish

```sh
rsync -rlt --delete apps/web/dist/ root@104.36.65.54:/var/www/openpixels-app/
rsync -rlt --delete website/       root@104.36.65.54:/var/www/openpixels-site/
```

**Use `-rlt`, not `-a`, and no `--info=`.** macOS ships rsync 2.6.9
(openrsync), which does not support `--info=stats2` and fails by printing its
usage text — and if you piped it to `tail`, the pipeline still exits 0, so it
looks like it worked. Nothing transfers. Check the byte count, not the exit
code.

## The nginx config

Three files in `deploy/`, copied to the server:

```sh
scp deploy/openpixels-security.conf   root@104.36.65.54:/etc/nginx/snippets/
scp deploy/openpixels.app.conf        root@104.36.65.54:/etc/nginx/sites-available/openpixels.app
scp deploy/app.openpixels.app.conf    root@104.36.65.54:/etc/nginx/sites-available/app.openpixels.app
ssh root@104.36.65.54 'nginx -t && systemctl reload nginx'
```

Those two server-block files are **bootstrap templates, not backups**. Once
certbot has run it owns the `listen 443`, the certificate paths and the
redirect blocks in the live files, and they exist only on the server. Diff
before you ever copy over a live one:

```sh
ssh root@104.36.65.54 'cat /etc/nginx/sites-available/openpixels.app' \
  | diff - deploy/openpixels.app.conf
```

Certificates were issued with:

```sh
certbot --nginx --redirect -d app.openpixels.app
certbot --nginx --redirect -d openpixels.app -d www.openpixels.app
```

## Three things in the config are load-bearing

1. **`.mjs` must be served as `text/javascript`.** This server's
   `/etc/nginx/mime.types` has no `.mjs` entry, so it would otherwise go out
   as `application/octet-stream` and the browser would refuse the module.
   onnxruntime-web reaches its runtime through a dynamic import of an `.mjs`,
   so the symptom is "Failed to fetch dynamically imported module" and a
   silent fall back to CPU — or no inference at all. Nothing in the error
   mentions a MIME type.
2. **`connect-src 'self'` in the CSP.** This is what makes a future
   dependency that phones home fail loudly in the browser instead of quietly
   succeeding. It is the privacy claim, expressed as a header.
3. **`include snippets/openpixels-security.conf` in *every* location.**
   `add_header` does not accumulate: a location with any `add_header` of its
   own inherits none from its parent. Every location here sets a
   `Cache-Control`, so leaving the include out strips the CSP from exactly
   the responses that matter, with nothing in `nginx -t` to warn you.

## The models are a public dependency, served from the apex

The browser extension fetches weights from `https://openpixels.app/models/`
— the **apex**, not `app.` — because a store package cannot carry half a
gigabyte. That URL is compiled into every released extension
(`apps/extension/vite.config.js`), which makes it an API.

So the apex config carries a `location /models/` that `alias`es into
`/var/www/openpixels-app/models/`. One copy on disk, reachable under both
hostnames. **Never rename or remove a file a released extension asks for** —
a new model is a new filename and a new extension version.

Anyone can host their own copy: `MODELS.md` lists every checksum, and an
installed extension can be pointed at a different origin from its
**Downloads** page.

## Checking a deployment

Curl proves the plumbing:

```sh
curl -sSI https://app.openpixels.app/ort/ort-wasm-simd-threaded.mjs | grep -i content-type
# content-type: text/javascript          <- not application/octet-stream
curl -sSI https://openpixels.app/models/u2netp.onnx | grep -i 'access-control\|cache-control'
# both present, or a released extension cannot fetch models
curl -sSI https://app.openpixels.app/ | grep -i content-security-policy
```

Curl cannot prove the app *works*, and every way this breaks is silent — a
blocked script, a refused module, a model that 404s all leave a page that
looks fine and simply never produces a result. So finish with a real browser
doing a real upscale against the deployed host:

```sh
npm --prefix apps/web run verify:prod
```

It loads `https://app.openpixels.app`, enhances a photo, asserts the result
actually got sharper and stayed faithful, and fails the run on any CSP
violation, failed request or page error. Point it elsewhere with
`node apps/web/e2e/verify-prod.mjs --host https://staging.example`.

## DNS

`@`, `www` and `app` are A records to `104.36.65.54`, managed at Namecheap.

**Watch for a leftover URL-redirect record on `@`.** A parked domain carries
one, it is invisible to the Namecheap API (it comes back only as
`omittedRecords`), and it cannot be deleted through the API — it has to go
from the dashboard, under Advanced DNS. Left in place it coexists with the A
record, so the apex round-robins between the real server and Namecheap's
parking IP. Over plain HTTP that shows up as a redirect to
`www.openpixels.app/?from=@`; over **HTTPS the parking IP simply times out**,
and because the site sends HSTS, a browser that has once loaded the site will
refuse to fall back to HTTP. Half of all visits fail, intermittently, which
is the worst way for it to fail.

```sh
dig +short openpixels.app A      # must be exactly 104.36.65.54, one line
```

## What a visitor downloads

| | |
|---|---|
| app JS + CSS | ~48 KB gzipped |
| fonts (3 faces) | 41 KB |
| `pixels_core_bg.wasm` | 188 KB (87 KB gzipped) |
| ONNX runtime | 14 MB (CPU) **or** 26 MB (WebGPU) |
| the fast upscaling model | 4.9 MB |

Exactly one ONNX runtime is fetched: the app picks the WebGPU build when the
browser has WebGPU and the CPU build when it does not. Both are shipped,
which costs disk on the host and nothing on the wire.

Models are fetched on first use with a progress bar, not precached — someone
reading the pricing page should not silently pull hundreds of megabytes. The
face restorer is 170 MB and the colouriser 255 MB, and the app says so
before either starts.
