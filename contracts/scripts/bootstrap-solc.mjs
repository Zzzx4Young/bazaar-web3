import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
const binary = new URL("../.tools/solc-0.8.30", import.meta.url);
// Official Solidity linux-amd64 release. Checksum must match before execution.
const sha256 =
  "f3e987dc6ecebd4bd350c48edcbc320b46cf9e3109bd3fc3d88f1acaf4c428f7";
await mkdir(new URL("../.tools/", import.meta.url), { recursive: true });
let bytes;
try {
  bytes = await readFile(binary);
} catch {
  const response = await fetch(
    "https://github.com/ethereum/solidity/releases/download/v0.8.30/solc-static-linux",
  );
  if (!response.ok)
    throw new Error(`Solidity download HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash("sha256").update(bytes).digest("hex") !== sha256)
  throw new Error("Solidity checksum mismatch");
await writeFile(binary, bytes);
await chmod(binary, 0o755);
console.log("Solidity 0.8.30 binary SHA-256 verified (Linux x86_64)");
