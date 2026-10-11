#!/bin/sh
# Netlify runs this before a build: exit 0 skips the build, exit 1 builds.
#
# - Drafts from the editor are branches named cms/... with a pull request. They must never
#   build: a draft is not published, and every build costs credits. The same goes for any
#   deploy preview or branch deploy.
# - On main, only a change to what igred.org is made from builds: www/, the reports build and
#   its dependencies. The hourly data commits do not, so data never triggers a build.
case "$HEAD" in cms/*) echo "editor draft ($HEAD): skipped"; exit 0 ;; esac
case "$BRANCH" in cms/*) echo "editor draft ($BRANCH): skipped"; exit 0 ;; esac
if [ "$CONTEXT" = "deploy-preview" ] || [ "$CONTEXT" = "branch-deploy" ]; then
  echo "$CONTEXT: skipped"; exit 0
fi
git diff --quiet "${CACHED_COMMIT_REF:-HEAD^}" "${COMMIT_REF:-HEAD}" -- www netlify.toml scripts/build-reports.ts scripts/netlify-ignore.sh config/brand.json src/core/brand.ts package.json package-lock.json
