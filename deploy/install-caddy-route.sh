#!/bin/sh
# Adds the /buylist route to the host Caddy and reloads it. Run with sudo.
set -eu
CADDYFILE=/etc/caddy/Caddyfile

if grep -q 'handle /buylist' "$CADDYFILE"; then
  echo "Route already present in $CADDYFILE, nothing to do."
  exit 0
fi

BACKUP="$CADDYFILE.bak.$(date +%s)"
cp "$CADDYFILE" "$BACKUP"

# Insert right after the /workouttracker handler's closing brace inside the m2kura.dev block.
awk '
  { print }
  /handle \/workouttracker\*/ { inblock = 1 }
  inblock && /^    }$/ {
    print "    handle /buylist* {"
    print "        reverse_proxy localhost:3005"
    print "    }"
    inblock = 0
  }
' "$BACKUP" > "$CADDYFILE.new"

if ! grep -q 'handle /buylist' "$CADDYFILE.new"; then
  echo "Could not find the /workouttracker handler to insert after; left unchanged." >&2
  rm -f "$CADDYFILE.new"
  exit 1
fi
if ! caddy validate --adapter caddyfile --config "$CADDYFILE.new" >/dev/null 2>&1; then
  echo "Generated Caddyfile failed validation; left unchanged. See $CADDYFILE.new" >&2
  exit 1
fi
mv "$CADDYFILE.new" "$CADDYFILE"
systemctl reload caddy
echo "Added /buylist route (backup: $BACKUP) and reloaded Caddy."
