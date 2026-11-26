#!/usr/bin/env bash
# Fails where a Dockerfile pins its base image to a build more than MAX_DAYS (14) older than its
# tag's current one, naming the file; an image that builds reproducibly (no date) is Dependabot's
# alone. .github/workflows/base-images.yml runs it once a week; locally: scripts/base-image-check.sh
set -euo pipefail
MAX_DAYS=${MAX_DAYS:-14}
created() {
  docker buildx imagetools inspect "$1" --format '{{json .Image}}' | jq -r '(."linux/amd64" // .).created'
}
stale=0
while read -r file ref; do
  image="${ref%@*}"
  pinned="${ref#*@}"
  current="$(docker buildx imagetools inspect "$image" --format '{{json .Manifest}}' | jq -r .digest)"
  if [ "$current" = "$pinned" ]; then
    echo "${file}: ${image} is its tag's current build"
    continue
  fi
  was="$(created "$ref")"
  now="$(created "$image")"
  if [[ "$was" == 1970-* || "$now" == 1970-* ]]; then
    echo "::notice file=${file}::${image} builds reproducibly, without a date: Dependabot's docker entry moves its digest"
    continue
  fi
  behind=$((($(date -d "$now" +%s) - $(date -d "$was" +%s)) / 86400))
  if [ "$behind" -gt "$MAX_DAYS" ]; then
    echo "::error file=${file}::${image}: the pinned build is ${behind} days older than the tag's current one, ${current}; move the digest"
    stale=1
  else
    echo "${file}: ${image} is ${behind} days behind its tag, within ${MAX_DAYS}"
  fi
done < <(grep -rn --include=Dockerfile --exclude-dir=node_modules -E '^FROM[[:space:]]+[^[:space:]]+@sha256:' . |
  sed -E 's/^\.\/([^:]+):[0-9]+:FROM[[:space:]]+([^[:space:]]+).*/\1 \2/')
exit "$stale"
