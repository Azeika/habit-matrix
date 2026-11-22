#!/bin/sh
# Build the app and stamp the service worker with a version, so open apps
# notice when a new version is published.
set -e
cd "$(dirname "$0")"
npx esbuild src/main.js --bundle --minify --format=iife --target=es2019 --outfile=app.js
V=$(cat index.html app.js firebase-config.js manifest.webmanifest | sha1sum | cut -c1-10)
sed -i "s/^const VERSION = '.*';/const VERSION = 'hm-$V';/" sw.js
echo "built version hm-$V"
