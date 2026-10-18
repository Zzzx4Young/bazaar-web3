# Test catalog illustrations

These JPEGs are category illustrations for the local V2 test catalog. They do **not** depict the specific listing, item condition, or delivered digital content. The listing description and web UI label them as illustrative.

`sources.json` records each Wikimedia Commons file page, author, CC0 label, downloaded size, and SHA-256. The images were downloaded as JPEG thumbnails through the Commons API. Review the source page before reuse outside this test catalog.

From `backend/`, run `NODE_USE_ENV_PROXY=1 node scripts/download-catalog-illustrations.mjs` to refresh the source images. Run `node --env-file=.env scripts/enrich-published-test-media.mjs` for a read-only dry run. To apply to the local development database, supply the Garage environment variables from `start.sh` and append `--apply`; the importer uses the media and listing APIs, skips listings that already have media, and excludes one-off listings with orders. It rejects non-loopback or non-`bazaar_dev` database URLs.
