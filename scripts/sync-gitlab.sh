#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 YOUBIQUO S.r.l.
#
# Mirrors this repository to a secondary remote (the internal GitLab server).
# The primary remote stays GitHub, so an unreachable internal network never
# blocks normal pushes.
#
# Usage:
#   scripts/sync-gitlab.sh [branch]            # push the local branch
#   AETOS_SYNC_FROM=origin scripts/sync-gitlab.sh main
#                                             # mirror GitHub's branch instead
#   AETOS_SYNC_REMOTE=gitlab scripts/sync-gitlab.sh
#
# Exit codes: 0 synced (or already up to date), 1 failure.
set -euo pipefail

remote="${AETOS_SYNC_REMOTE:-gitlab}"
branch="${1:-$(git symbolic-ref --quiet --short HEAD || echo main)}"
source_remote="${AETOS_SYNC_FROM:-}"
attempts="${AETOS_SYNC_ATTEMPTS:-3}"

if ! git remote get-url "$remote" >/dev/null 2>&1; then
  echo "Remote '$remote' is not configured. Add it with:" >&2
  echo "  git remote add $remote ssh://git@git.internal.youbiquo.eu:2222/aetos/aetos-office-assistant.git" >&2
  exit 1
fi

if [ -n "$source_remote" ]; then
  echo "Mirroring $source_remote/$branch -> $remote/$branch"
else
  echo "Mirroring $branch -> $remote/$branch"
fi

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

# When mirroring a remote, take the branch and tags from it rather than from a
# possibly stale or dirty working copy.
if [ -n "$source_remote" ]; then
  git fetch --prune --tags "$source_remote" "+refs/heads/$branch:refs/remotes/$source_remote/$branch"
  push_ref="$source_remote/$branch"
else
  push_ref="$branch"
fi

git push "$remote" "$push_ref:refs/heads/$branch"

# Branches fast-forward, but a moved release tag does not. Retry with --force
# only when the plain push is rejected; the remote is a read-only mirror.
if ! git push "$remote" --tags 2>/dev/null; then
  echo "  some tags moved; updating them on the mirror" >&2
  git push "$remote" --tags --force
fi

echo "Done: '$remote' matches ${push_ref} and the local tags."
