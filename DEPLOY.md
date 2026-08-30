# Deploying ATLAS (KG_viz)

The app is a static Vite build served by nginx in a container. The one thing
that isn't fully self-contained: the ~51 MB `public/kg-data.json` /
`public/kg-keywords.json` files are **bind-mounted at runtime, not baked into
the image** (see `docker-compose.yml`), so refreshing the dataset never
requires rebuilding or redeploying.

## 1. Get the data files onto the server

These are generated locally (they need the local `LDM-KG_dump_2026-02-09.ttl`
dump and, for keywords, live SPARQL access — see `npm run build-kg` in
`package.json`), not inside Docker. Generate them once here:

```bash
npm run build-kg   # writes public/kg-data.json and public/kg-keywords.json
```

Then copy the whole `public/` folder to the server, next to where you'll keep
`docker-compose.yml` (same relative path the compose file expects):

```bash
scp -r public/ user@server:/path/to/atlas/
```

To refresh the dataset later, just repeat this step and re-run
`docker compose up -d` (no image rebuild — nginx will pick up the new files
on next request, or restart the container to be sure).

## 2. Get the source onto the server

Whatever's already your convention for the other Docker apps on that server —
either:

```bash
# on the server
git clone https://github.com/TIBHannover/KG_viz.git
cd KG_viz
git checkout keyword_sparql   # or whichever branch you want live
```

or build the image locally and transfer it directly:

```bash
docker build -t atlas:latest \
  --build-arg VITE_SPARQL_ENDPOINT=https://YOUR-VIRTUOSO-HOST/sparql \
  --build-arg VITE_SPARQL_GRAPH=urn:your-graph .
docker save atlas:latest | gzip > atlas.tar.gz
scp atlas.tar.gz user@server:/path/to/atlas/
# on the server
gunzip -c atlas.tar.gz | docker load
```

## 3. Configure and run

Edit `docker-compose.yml` on the server:
- `VITE_SPARQL_ENDPOINT` / `VITE_SPARQL_GRAPH` → the real Virtuoso endpoint
  and graph (only needed if building on the server; skip if you transferred
  a pre-built image).
- The host port in `ports:` (`8091` is a placeholder) → whatever port IT
  wants the reverse proxy to target.

```bash
docker compose build   # skip if you loaded a pre-built image instead
docker compose up -d
```

## 4. Verify

```bash
curl -I http://localhost:8091/                  # 200, text/html
curl -I http://localhost:8091/kg-data.json       # 200, Content-Length ~51MB
curl -sI http://localhost:8091/ -H 'Accept-Encoding: gzip' | grep -i content-encoding
```

Then open it in a browser and confirm both the Hairball and Adaptive views
render and load data.

## 5. Checklist item outside this repo: CORS on the Virtuoso endpoint

`src/keyword-expand.js` makes **live SPARQL calls from the browser** to
`VITE_SPARQL_ENDPOINT` (not just at build time). That endpoint must send
`Access-Control-Allow-Origin` for whatever domain IT points at this
container, or keyword expansion will silently fail in the browser console —
this isn't something the Docker setup here can fix.

## 6. Domain + HTTPS

Once the container is up and reachable on its host port, hand that off to
IT — they front it with the domain + TLS the same way as your other
Docker-based apps on that server.
