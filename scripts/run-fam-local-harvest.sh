#!/bin/zsh
set -euo pipefail

repo_dir="${FAM_COLLECTOR_REPO:-$HOME/Documents/Codex/runtime/atletas-fam-collector}"
cd "$repo_dir"
git pull --ff-only --quiet
if [[ ! -d node_modules ]]; then npm ci --silent; fi
node scripts/fam-local-harvest.mjs
if git diff --quiet -- data/official-results/fam-live-snapshot.json; then exit 0; fi
git add data/official-results/fam-live-snapshot.json
git -c user.name="Club Atletas FAM Collector" -c user.email="info@atletasdefuenlabrada.com" commit -m "Update official FAM results snapshot"
git push origin main
