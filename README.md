# BuyList

A minimal app for tracking things to buy, grouped into lists (IKEA, studio tools, Xmas gifts…).
Each item needs only a name; optionally it has links to where to buy it, a price and currency,
a quantity, a buy-by date, a priority and a note. Ticked items move to a collapsible **Bought** section.

Live at **https://m2kura.dev/buylist**.

## Stack

- **Frontend**: Vite + vanilla JS + plain CSS (`src/`), Inter font, light/dark from the OS setting.
- **Backend**: Fastify on Node 24 (`server/`), serving the API and the built frontend under `/buylist`.
- **Database**: SQLite via Node's built-in `node:sqlite` (`data/buylist.db`). Every row is scoped to its user.
- **Auth**: login only, no sign-up. scrypt password hashes, httpOnly session cookie (60 days, sliding),
  10 failed logins per IP → 15-minute block.

## Users

```sh
docker compose exec app node server/cli.js add <username>      # asks for password
docker compose exec app node server/cli.js passwd <username>   # change password + log out sessions
docker compose exec app node server/cli.js list
docker compose exec app node server/cli.js remove <username>   # deletes the user AND their lists
```

Logged-in users can also change their password from the key icon next to their name.

## Deployment (this server)

```sh
docker compose up -d --build        # build + (re)start; data lives in the buylist_data volume
```

The container listens on `127.0.0.1:3005`. The host Caddy routes `m2kura.dev/buylist*` to it
(`deploy/Caddyfile.snippet`; `sudo deploy/install-caddy-route.sh` adds it once). Cloudflare Tunnel
already sends `m2kura.dev` to Caddy on :80.

Backup (safe while running):

```sh
docker compose exec app node -e "new (require('node:sqlite').DatabaseSync)('/app/data/buylist.db').exec(\"VACUUM INTO '/app/data/backup.db'\")"
docker compose cp app:/app/data/backup.db ./buylist-$(date +%F).db
```

## Development

```sh
npm install
npm run users add me      # creates data/buylist.db with a user
npm run dev               # API on :3005, Vite on http://localhost:5174/buylist/
```
