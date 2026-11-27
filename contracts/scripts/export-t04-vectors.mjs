// Run from backend using its disposable Web3 database wrapper. No .env/key files.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { testnetFixture } from "../../backend/tests/helpers/testnet.mjs";
import { PaymentIntentService } from "../../backend/dist/web3/payment-intent.service.js";
import {
  LocalPaymentSigner,
  paymentTypes,
  paymentTypedData,
  paymentDigest,
  orderTermsDigest,
} from "../../backend/dist/web3/payment-signer.js";
import { PostgresPaymentJournal } from "../../backend/dist/web3/payment-journal.js";
import { WalletAuthService } from "../../backend/dist/auth/wallet-auth.service.js";
import { SellerPayoutService } from "../../backend/dist/web3/seller-payout.service.js";
import { hashPassword } from "../../backend/dist/auth/password.js";
const require = createRequire(
  new URL("../../backend/package.json", import.meta.url),
);
const { encodeAbiParameters, recoverTypedDataAddress } = require("viem");
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");
const out = new URL("../.tmp/", import.meta.url);
const sourceCommit = execFileSync(
  "git",
  [
    "-C",
    fileURLToPath(new URL("../../", import.meta.url)),
    "rev-parse",
    "HEAD",
  ],
  { encoding: "utf8" },
).trim();
const deployment = JSON.parse(
  await readFile(new URL("local-addresses.json", out), "utf8"),
);
const source = await readFile(
  new URL("../../backend/src/web3/payment-signer.ts", import.meta.url),
);
const dist = await readFile(
  new URL("../../backend/dist/web3/payment-signer.js", import.meta.url),
);
const ts = require("typescript");
const config = ts.readConfigFile(
  new URL("../../backend/tsconfig.json", import.meta.url).pathname,
  ts.sys.readFile,
).config;
const options = ts.convertCompilerOptionsFromJson(
  config.compilerOptions,
  ".",
).options;
const normalize = (text) =>
  text.replace(/\/\/# sourceMappingURL=.*$/m, "").trim();
for (const name of ["payment-signer", "payment-intent.service"]) {
  const text = await readFile(
    new URL(`../../backend/src/web3/${name}.ts`, import.meta.url),
    "utf8",
  );
  const js = await readFile(
    new URL(`../../backend/dist/web3/${name}.js`, import.meta.url),
    "utf8",
  );
  const emitted = ts.transpileModule(text, {
    compilerOptions: { ...options, module: ts.ModuleKind.ESNext },
    fileName: `${name}.ts`,
  }).outputText;
  assert.ok(
    normalize(emitted) === normalize(js),
    `Rebuild backend dist before using ${name}; source/dist differ`,
  );
}
const t = await testnetFixture();
try {
  // Mutate only this fixture's config BEFORE publishing/ordering. All addresses local.
  t.config.token = deployment.token.toLowerCase();
  t.config.escrow = deployment.escrow.toLowerCase();
  await t.bind();
  const wallets = new WalletAuthService(
    t.db.client,
    t.auth,
    t.security.ledger,
    {
      ...t.config,
      appOrigin: "http://localhost:3000",
      assertEoa: async () => {},
    },
  );
  const payout = new SellerPayoutService(
    t.db.client,
    wallets,
    t.security.ledger,
    t.config,
  );
  const payoutKey = randomUUID();
  const payoutProof = await wallets.requestPasswordReauth(
    t.user,
    "Virtual-T03-seller-password-only",
    "payout",
    t.w.address,
    payoutKey,
    "127.0.0.1",
  );
  const payoutChallenge = await wallets.createActionChallenge(
    t.user,
    payoutProof.id,
    "payout",
    t.w.address,
    payoutKey,
  );
  await payout.confirmSellerPayout(
    t.user,
    payoutChallenge.id,
    await t.w.signTypedData(payoutChallenge.typedData),
  );
  await t.price("1.000001");
  const password = "Virtual-T06-local-buyer-only";
  await t.db.client.accountCredential.create({
    data: { accountId: t.f.buyer, passwordHash: await hashPassword(password) },
  });
  const account = await t.db.client.account.findUniqueOrThrow({
    where: { id: t.f.buyer },
  });
  const user = await t.auth.login(account.loginName, password, "127.0.0.3");
  const buyer = privateKeyToAccount(generatePrivateKey()),
    bindingKey = randomUUID();
  const proof = await t.wallets.requestPasswordReauth(
    user,
    password,
    "bind",
    buyer.address,
    bindingKey,
    "127.0.0.3",
  );
  const challenge = await t.wallets.createActionChallenge(
    user,
    proof.id,
    "bind",
    buyer.address,
    bindingKey,
  );
  await t.wallets.consumeActionChallenge(
    user,
    challenge.id,
    await buyer.signTypedData(challenge.typedData),
  );
  const signer = new LocalPaymentSigner(
    generatePrivateKey(),
    "0x" + "c".repeat(64),
  );
  // Capture only signer PUBLIC address from the produced signature, never its secret.
  let signatureCalls = 0;
  const sign = signer.sign.bind(signer);
  signer.sign = async (permit) => {
    signatureCalls++;
    return sign(permit);
  };
  const journal = new PostgresPaymentJournal(t.security.client, t.security.id);
  const service = new PaymentIntentService(
    t.db.client,
    t.auth,
    payout,
    t.security.ledger,
    journal,
    signer,
    null,
    t.config,
    async () => {},
  );
  const key = randomUUID();
  const a = await service.createOrder(user, key, {
    listingId: t.f.listing.id,
    version: 2,
  });
  assert(a.signature);
  const reread = await service.read(user, a.intentId);
  assert.deepEqual(reread, a);
  assert.equal(a.permit.stockGeneration, "0");
  assert.equal(a.permit.payDeadline - a.permit.issuedAt, 1800);
  const rows = await t.db.client.paymentIntent.count();
  assert.equal(rows, 1);
  assert.equal(signatureCalls, 1);
  const serviceRefusals = [];
  async function refused(name, action) {
    const callsBefore = signatureCalls;
    try {
      await action();
      assert.fail(`${name} unexpectedly succeeded`);
    } catch (e) {
      if (e.code === "ERR_ASSERTION") throw e;
      assert.match(
        e.message,
        /STATE_CONFLICT|INVENTORY_CONFLICT|UNAVAILABLE|NOT_FOUND/,
      );
      assert.equal(signatureCalls, callsBefore);
      serviceRefusals.push({
        name,
        signatureCallsBefore: callsBefore,
        signatureCallsAfter: signatureCalls,
        layer: "actual PaymentIntentService",
        result: "rejected",
        error: e.message,
      });
    }
  }
  await refused("occupied stock refuses second order", () =>
    service.createOrder(user, randomUUID(), {
      listingId: t.f.listing.id,
      version: 2,
    }),
  );
  await refused("no verified invalidation refuses replacement", () =>
    service.replaceIntent(user, a.orderId, randomUUID(), a.intentId),
  );
  // Deliberately corrupt only random fixture JSON; service must detect snapshot mismatch.
  const row = await t.db.client.paymentIntent.findUniqueOrThrow({
    where: { id: a.intentId },
  });
  await t.db.client.paymentIntent.update({
    where: { id: a.intentId },
    data: { permit: { ...a.permit, amountAtoms: "1000002" } },
  });
  await refused("mutated committed tuple refuses reread signature", () =>
    service.read(user, a.intentId),
  );
  await t.db.client.paymentIntent.update({
    where: { id: a.intentId },
    data: { permit: row.permit },
  });
  const terms = await t.db.client.paymentOrderTerms.findUniqueOrThrow({
    where: { orderId: a.orderId },
  });
  assert.equal(terms.termsHash, orderTermsDigest(a.permit));
  const message = paymentTypedData(a.permit).message;
  const permitAbi = encodeAbiParameters(
    paymentTypes.PaymentPermit,
    paymentTypes.PaymentPermit.map(({ name }) => message[name]),
  );
  const signerAddress = await recoverTypedDataAddress({
    ...paymentTypedData(a.permit),
    signature: a.signature,
  });
  const vector = {
    runId: randomUUID(),
    environment: "L/D only; no RPC",
    sourceCommit,
    t04ImplementationBase: "d924a52660a79c3daa172eaf4974a1822c935271",
    source:
      "actual PaymentIntentService.createOrder + read; testnetFixture + PostgresPaymentJournal; random disposable schemas on 55435",
    paymentSignerSourceSha256: createHash("sha256")
      .update(source)
      .digest("hex"),
    paymentSignerDistSha256: createHash("sha256").update(dist).digest("hex"),
    chainId: a.permit.chainId,
    escrow: a.permit.escrow,
    permit: a.permit,
    permitAbi,
    signature: a.signature,
    signerAddress,
    paymentDigest: paymentDigest(a.permit),
    termsDigest: terms.termsHash,
    serviceRefusalCount: serviceRefusals.length,
  };
  await writeFile(
    new URL("t04-vectors.json", out),
    JSON.stringify(vector, null, 2) + "\n",
    { mode: 0o600 },
  );
  await writeFile(
    new URL("service-refusals.json", out),
    JSON.stringify({ runId: vector.runId, serviceRefusals }, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    `Actual T04 service: 1 committed permit, identical reread, ${serviceRefusals.length} independent service refusals; vector saved under contracts/.tmp`,
  );
} finally {
  await t.close();
}
