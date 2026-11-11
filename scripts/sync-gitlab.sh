#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 YOUBIQUO S.r.l.
#
# Mirrors this repository to a secondary remote (the internal GitLab server).
# The primary remote stays GitHub, so an unreachable internal network never
# blocks normal pushes.
#
# Usage:
#   scripts/sync-gitlab.sh [branch]      # default branch: current branch
#   AETOS_SYNC_REMOTE=gitlab scripts/sync-gitlab.sh
set -euo pipefail

remote="${AETOS_SYNC_REMOTE:-gitlab}"
branch="${1:-$(git symbolic-ref --quiet --short HEAD || echo main)}"
attempts="${AETOS_SYNC_ATTEMPTS:-3}"

if ! git remote get-url "$remote" >/dev/null 2>&1; then
  echo "Remote '$remote' is not configured. Add it with:" >&2
  echo "  git remote add $remote ssh://git@git.internal.youbiquo.eu:2222/aetos/aetos-office-assistant.git" >&2
  exit 1
fi

echo "Mirroring $branch and tags to '$remote'"

# The internal server is sometimes briefly unreachable. Retry before failing.
for attempt in $(seq 1 "$attempts"); do
  if git ls-remote --exit-code "$remote" >/dev/null 2>&1; then
    break
  fi
  echo "  attempt $attempt/$attempts: cannot reach '$remote'" >&2
  if [ "$attempt" -eq "$attempts" ]; then
    echo "Giving up: '$remote' is unreachable." >&2
    exit 1
  fi
  sleep 5
done

git push "$remote" "$branch"

# Branches fast-forward, but a moved release tag does not. Retry with --force
# only when the plain push is rejected; the remote is a read-only mirror.
if ! git push "$remote" --tags 2>/dev/null; then
  echo "  some tags moved; updating them on the mirror" >&2
  git push "$remote" --tags --force
fi

echo "Done: '$remote' now matches $branch and the local tags."
