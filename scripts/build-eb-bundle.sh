#!/usr/bin/env bash
# Build one deployable, self-contained Elastic Beanstalk bundle.
set -euo pipefail

version="${1:?usage: build-eb-bundle.sh <immutable-version> [output-zip]}"
output="${2:-dist/eb-${version}.zip}"
[[ "$version" =~ ^[0-9a-f]{40}$ ]] || { echo "Version must be a full Git commit SHA" >&2; exit 64; }

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
git diff --quiet || { echo "Refusing to bundle a dirty checkout" >&2; exit 65; }
[[ "$(git rev-parse HEAD)" == "$version" ]] || { echo "Version is not HEAD" >&2; exit 65; }

pnpm run build:vm
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

# `pnpm deploy` materializes production dependencies, including workspace
# dependencies, rather than relying on the build runner's node_modules.
pnpm --filter @workspace/api-server deploy --legacy --prod "$stage/app"
# The legacy deploy can leave a self-link that escapes back to the CI checkout.
# It resolves while building but is invalid in the standalone EB artifact.
while IFS= read -r -d '' link; do
  target="$(realpath -m "$(dirname "$link")/$(readlink "$link")")"
  [[ "$target" == "$stage/app/"* ]] || rm -f "$link"
done < <(find "$stage/app/node_modules" -type l -print0)
mkdir -p "$stage/app/dist" "$stage/app/public"
cp artifacts/api-server/dist/index.mjs "$stage/app/dist/index.mjs"
cp -R artifacts/rmone-web/dist/public/. "$stage/app/public/"
cat >"$stage/app/Procfile" <<'EOF'
web: SERVE_WEB_DIR=public node dist/index.mjs
EOF
mkdir -p "$stage/app/.platform/nginx/conf.d"
cat >"$stage/app/.platform/nginx/conf.d/upload_size.conf" <<'EOF'
client_max_body_size 64M;
EOF
printf '%s\n' "$version" >"$stage/app/RELEASE_VERSION"

# The rotation-proof credential overlay (lib/db/src/master-credentials.ts)
# dynamically imports the Secrets Manager SDK at runtime; esbuild leaves it
# external, so it MUST resolve from dist/ in the deployed layout. pnpm deploy
# materializes only api-server's OWN production dependencies at the app root —
# a dependency declared solely in a workspace lib lands in a nested .pnpm
# context that dist/index.mjs cannot resolve, and the overlay would silently
# fall back to the stale URL credentials (the exact outage this guards against).
cat >"$stage/app/dist/resolve-probe.mjs" <<'EOF'
await import("@aws-sdk/client-secrets-manager");
EOF
node "$stage/app/dist/resolve-probe.mjs" || {
  echo "EB bundle cannot resolve @aws-sdk/client-secrets-manager from dist/ — keep it in api-server dependencies" >&2
  exit 66
}
rm "$stage/app/dist/resolve-probe.mjs"

mkdir -p "$(dirname "$output")"
# Preserve pnpm's relative symlink graph. Dereferencing these links moves each
# package out of its .pnpm dependency context and causes runtime module misses.
(cd "$stage/app" && zip -X -q -y -r "$root/$output" .)
echo "Built $output for $version"