#!/usr/bin/env bash
# Cache-bust the app shell so GitHub Pages' 10-minute asset cache never serves
# stale code. Stamps a fresh ?v=<timestamp> on the CSS link, the module entry,
# and every relative ES-module import (browsers key modules by full URL, so the
# whole graph must carry the version). Run before pushing UI/CSS changes:
#     tools/bump.sh && git commit -am "…" && git push
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(date +%s)

# index.html: stylesheet + entry module
perl -pi -e "s{(href=\"app\.css)(\?v=\d+)?(\")}{\$1?v=$V\$3}g;
             s{(src=\"js/app\.js)(\?v=\d+)?(\")}{\$1?v=$V\$3}g" index.html

# js modules: relative imports like  from './views.js'
perl -pi -e "s{(from '\./[a-z]+\.js)(\?v=\d+)?(')}{\$1?v=$V\$3}g" js/*.js

echo "cache-bust version: $V"
