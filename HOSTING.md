# Putting this on your own website

The whole thing is four files. There is no server, no database, and nothing to install on your
host — it is a web page that happens to do a lot of arithmetic in the visitor's browser.

## Every time you want to publish an update

```bash
npm run build
```

That writes a folder called `dist/`. **Upload the contents of `dist/` to a folder on your web
host** — for example `yoursite.com/eeg/` — and that is the whole deployment.

```
dist/index.html                 the page
dist/assets/index-<hash>.css    styling
dist/assets/index-<hash>.js     the simulator itself
dist/assets/index-<hash>.js.map optional, see below
```

Upload the folder *contents*, not the folder itself, unless you want the URL to end in `/dist/`.

## Things that would otherwise catch you out

**It works in a subfolder.** The build uses relative links, so `yoursite.com/eeg/` works exactly
as well as `yoursite.com/`. You do not need to configure anything for this.

**The filenames change every build.** `index-C8ZLfQQQ.js` becomes something else next time. That is
deliberate — it stops visitors' browsers serving a stale cached copy. Upload the new files and
delete the old ones; `index.html` always points at the current pair.

**The `.js.map` file is optional.** It is a debugging aid that makes browser dev-tools show the
original source. Skipping it takes the upload from ~730 KB to ~210 KB and changes nothing a
visitor sees.

**Nothing phones home.** The page makes no network requests once loaded. Everything — the head
model, the parameter registry, all signal generation — is compiled into that one JavaScript file.
It works offline and it sends nothing anywhere.

**It runs entirely on the visitor's computer, and this is checkable.** Against the built bundle:

| checked for | found |
|---|---|
| external URLs (CDNs, fonts, analytics) | none — the one `https://` string is the FreeSurfer licence *reference* in the attribution text, which nothing requests |
| `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` | one `fetch`, Vite's own preloader for this page's script and stylesheet, same origin |
| `localStorage` / `sessionStorage` / `cookies` / `indexedDB` | none |
| `navigator.sendBeacon` (silent analytics) | none |
| external stylesheet or font links | none — the only `<link>` is the relative one to your own copy |

So the only network traffic is your server sending the page, exactly as it would for a static
HTML file. After that the browser generates every sample, runs every filter and computes every
readout locally. It works with the network unplugged.

Reproduce it yourself after any build:

```bash
grep -oaE "https?://[^\"' ]+" dist/assets/*.js dist/index.html
grep -oaF "localStorage" dist/assets/*.js
```

One thing this does **not** cover: your web host's own logs. Any server records which files were
requested, from which IP, like any website. That is your hosting setup rather than anything this
page does, but it is the honest boundary of the claim.

**No special server settings.** Any host that can serve static files will do: shared hosting,
Netlify, S3, a folder on a VPS. No PHP, no Node, no build step on the server.

## What GitHub is for, then

The repository is where the code and its documentation live, and where the automated checks run.
It is not where the site is served from. The two are independent: you can push to GitHub without
republishing the site, and republish the site without pushing.
