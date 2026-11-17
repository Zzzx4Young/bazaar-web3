# R06 resource control and bounded real-byte capacity sampling

Scope: R06 subitems 2 and 3 only, parent source
`afb1bfa63e63d8db6b252aa70125aa8679bde11c`. No production checker changes.
The frozen A23/A25 requirements retain decimal 20,000,000-byte PDF/PNG/JPEG
and 500,000,000-byte ZIP limits. R06sub1/browser and R08 remain parent-owned.

## Offline control image

From `backend/`, using independent copied backend dependencies and Node 22:

```bash
npm run build
CONTROL=$(bash scripts/build-file-control.sh)
PRIVATE_FILE_CHECK_IMAGE=sha256:1cca08651d855df02dca36b7a6347da847c41be4ecae2b01ff2733adb4316498 \
PRIVATE_FILE_CONTROL_IMAGE="$CONTROL" \
PRIVATE_FILE_EVIDENCE_DIR=/absolute/existing/evidence \
node --test --test-concurrency=1 tests/file-check-resource.integration.mjs
```

The build script checks the cached base ID before building. Docker build uses
`--pull=false` (the build equivalent of run `--pull=never`), `--network=none`
and the legacy builder to avoid BuildKit registry metadata resolution. No RUN,
package installs, downloads, or signature updates are needed. No credentials.
The output is the local immutable image ID, suitable for
`PRIVATE_FILE_CONTROL_IMAGE`; no registry RepoDigest is claimed.

`control.py` consumes exactly `sleep` or `memory` from `/input/object`.
Sleep spawns a real Python child and blocks; the application runtime must kill
and remove its container. The test independently observes the live child and
verifies container absence. Memory writes and retains allocations until the
kernel cgroup OOM kill. It never prints a simulated report or exits with a
fabricated OOM verdict. Tests require Docker's `OOMKilled=true`.
The image is test-only: never configure it as the application checker.

## Capacity reproduction (requires about 1.7 GB retained fixture disk)

```bash
bash scripts/run-file-capacity.sh /absolute/evidence/directory
node scripts/diagnose-file-capacity.mjs /absolute/evidence/directory
```

These scripts use the cached t10 image, no network/install, and no new deps.
The sampler generates twelve deterministic actual files: limit minus one,
limit, limit plus one for each format. Full file lengths and SHA256 are checked
before scans. ZIP member bytes and CRC are checked by the actual checker.
The generator uses real noisy image pixels, a PDF embedded image, inert source
and stored ZIP assets; legal format padding attains exact lengths. These are
synthetic representative formats, not a customer workload distribution.
Fixtures remain in `samples/` for audit; no host object-store roundtrip occurs.

The ordinary sampling test deliberately requires clean scans for in-limit
objects. It records every result before asserting, and fails if capacity is
insufficient. It must not be changed to accept a rejection to make CI green.
Without `PRIVATE_FILE_CAPACITY_SAMPLES` this expensive acceptance is opt-in.
The six existing resource cases are independent and all were run without skips.

Default production runtime: 4 GB memory, no swap, 1 CPU, 32 pids, 64 MB tmpfs,
120 seconds. A sequential sweep is followed by two simultaneous tasks (20 MB
PNG plus 500 MB ZIP). No API queue or aggregate service-capacity claim follows.
Independent live probes read cgroup v2 counters, child PID presence and tmpfs
statvfs, with about 200ms delay plus exec latency. Probe overhead is included.
`memory.peak` is a kernel high-water up to the last observed instant; final
peak may be missed. CPU is observed cumulative time, not peak utilization.
Temp is a sampled maximum; transient true peaks and host peaks are unavailable.
Missing probes must be treated as unavailable, not zero.

## Observed outcome, 2026-11-17

Evidence root: `/tmp/bazaar-rework-20261117/evidence/r06-resources`.
See `REPORT.md`, `revision.json`, raw JSON, image/tool/runtime records and TAP.

- Final resource suite: 6 pass, 0 fail, 0 skip; real spawned-child timeout and
  cgroup OOM kill confirmed. Immutable control image ID:
  `sha256:43aae1ed3fe229a40aa5b51b66adf6e73d29986a6d6c6642e1cdae0e0150e9c7`.
- PDF/PNG/JPEG at 19,999,999 and 20,000,000 bytes: full clean parser/ClamAV/hash;
  20,000,001 bytes: actual-container `FILE_SIZE` refusal.
- ZIP at 499,999,999 and 500,000,000 bytes: **capacity RED** under the unchanged
  64 MB tmpfs: `MALWARE_SCAN_INCOMPLETE`. 500,000,001 bytes: host actual-file stat
  refusal before container scan, not full scanning or an API metadata test.
- Exact diagnostic engine error: exit 2, `No space left on device` /
  `Can't write to file ERROR`. A diagnostic-only 1 GB tmpfs permits the same
  actual 500 MB ZIP to finish structural validation + ClamAV exit 0, about
  59.6 seconds, memory peak observed 2,117,234,688 bytes, temporary disk sampled
  maximum 500,002,816 bytes. This diagnostic does not fix or approve the product
  runtime; acceptance stays RED. No file limit was weakened.
- Two-task default-budget run: PNG clean, ZIP incomplete. Neither queue
  saturation nor full production capacity was accepted.
- Host full backend unit run: 289 passed, 0 skipped. Build/typecheck/lint passed;
  the earlier sandbox unit failures/hang are retained separately, not hidden.

Initial BuildKit attempt interpreted an image ID in FROM as a registry name
and tried metadata resolution (403). Its log is retained. No layers/packages
were obtained. The corrected final build is local-only as described above.

No DB, Garage, browser, credential/signature preparation or download acceptance
was run here. Local real-object scans do not close end-to-end storage or
production prerequisites. Application temp budget remediation is a follow-up;
this patch preserves the discovered RED and its exact root-cause evidence.
