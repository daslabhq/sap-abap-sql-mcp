#!/usr/bin/env bash
# Build the .mcpb bundle: a zip carrying the built server, its production
# dependencies, and manifest.json.
#
# The bundle runs on a user's machine with no install step, so dependencies go
# inside it rather than being resolved at run time. That is the whole point of
# the format, and the reason this is not just `npm pack`.
set -euo pipefail
cd "$(dirname "$0")/.."

bun run build
rm -rf .mcpb-build && mkdir -p .mcpb-build
cp manifest.json README.md LICENSE .mcpb-build/
cp -R dist .mcpb-build/

# A minimal package.json so npm installs only what the server needs at run time.
node -e '
  const p = require("./package.json");
  require("fs").writeFileSync(".mcpb-build/package.json", JSON.stringify(
    { name: p.name, version: p.version, type: "module", dependencies: p.dependencies }, null, 2));
'
(cd .mcpb-build && npm install --omit=dev --silent)

npx -y @anthropic-ai/mcpb@latest pack .mcpb-build sap-abap-sql.mcpb
