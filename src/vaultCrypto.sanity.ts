// Sanity check — exercises the vault crypto envelope (v1 legacy + v2/v3 HKDF)
// and prints PASS/FAIL per check. Run with:
//   bun run src/vaultCrypto.sanity.ts
import {
  createVaultSession,
  createV3AttachmentManifest,
  restoreVaultSession,
  encryptVaultPayload,
  decryptVaultPayload,
  encryptBytes,
  decryptBytes,
  encryptedChunkDigest,
  isEncryptedChunk,
  verifyV3AttachmentManifest,
} from "./vaultCrypto";
import type {
  VaultEncryptedPayload,
  VaultPayload,
} from "../functions/api/vault/schema";
import { isVaultEncryptedPayload } from "../functions/api/vault/schema";

let allPass = true;

function check(label: string, ok: boolean, detail = "") {
  const status = ok ? "PASS" : "FAIL";
  console.log(`  [${status}] ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) allPass = false;
}

function checkEq<T>(label: string, actual: T, expected: T) {
  const ok = actual === expected;
  check(
    label,
    ok,
    ok ? "" : `got ${String(actual)}, expected ${String(expected)}`,
  );
}

async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

function randomSaltBase64(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

// Lower production bound keeps the compatibility cases reasonably fast.
const TEST_ITERATIONS = 100_000;

function testKdf(salt = randomSaltBase64()): VaultEncryptedPayload["kdf"] {
  return { name: "PBKDF2", hash: "SHA-256", iterations: TEST_ITERATIONS, salt };
}

const SAMPLE_PAYLOAD: VaultPayload = {
  identities: [
    {
      id: "id-1",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "+44 7000 000000",
      address: "1 Analytical Engine Way",
      nino: "QQ123456C",
      nhsNumber: "999 999 9999",
      passNumber: "P123456789",
      utr: "1234567890",
      govGatewayId: "gg-1",
      notes: "unicode ✓ — émoji 🗝️",
      attachments: [],
      credentials: [
        {
          id: "cred-1",
          label: "HMRC",
          username: "ada",
          password: "s3cret!",
          website: "https://example.com",
          notes: "",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  apiKeys: [
    {
      id: "key-1",
      label: "Example Provider",
      service: "example-provider",
      key: "sk-test-not-real",
      environment: "prod",
      notes: "",
      createdAt: 3,
      updatedAt: 4,
    },
  ],
};

// Case 1 — createVaultSession (real 600k iterations, called once) round-trip.
async function case1() {
  console.log("\nCase 1: createVaultSession -> encrypt -> decrypt round-trip");
  const session = await createVaultSession("correct horse battery staple");
  checkEq("session version", session.version, 3);
  checkEq("kdf iterations", session.kdf.iterations, 600_000);
  check("kdf salt present", session.kdf.salt.length > 0);

  const encrypted = await encryptVaultPayload(SAMPLE_PAYLOAD, session);
  checkEq("envelope version", encrypted.version, 3);
  checkEq("envelope format", encrypted.format, "aes-gcm");
  check(
    "ciphertext differs from plaintext JSON",
    encrypted.ciphertext !== JSON.stringify(SAMPLE_PAYLOAD),
  );

  const decrypted = await decryptVaultPayload(encrypted, session);
  checkEq(
    "payload round-trips exactly",
    JSON.stringify(decrypted),
    JSON.stringify(SAMPLE_PAYLOAD),
  );
  return session;
}

// Case 2 — wrong password on a v2 envelope must fail to decrypt.
async function case2() {
  console.log("\nCase 2: wrong password rejects (v2, fast KDF)");
  const kdf = testKdf();
  const good = await restoreVaultSession("right-password", { version: 2, kdf });
  const encrypted = await encryptVaultPayload(SAMPLE_PAYLOAD, good);

  const bad = await restoreVaultSession("wrong-password", { version: 2, kdf });
  check("wrong-password session derives", bad.version === 2);
  check(
    "authToken differs for wrong password",
    bad.authToken !== good.authToken,
  );
  check(
    "decryptVaultPayload rejects with wrong password",
    await rejects(() => decryptVaultPayload(encrypted, bad)),
  );

  const rightAgain = await restoreVaultSession("right-password", {
    version: 2,
    kdf,
  });
  const decrypted = await decryptVaultPayload(encrypted, rightAgain);
  checkEq(
    "correct password still decrypts",
    JSON.stringify(decrypted),
    JSON.stringify(SAMPLE_PAYLOAD),
  );
}

// Case 3 — authToken determinism and shape.
async function case3() {
  console.log("\nCase 3: v2 authToken stability");
  const kdf = testKdf();
  const a = await restoreVaultSession("hunter2", { version: 2, kdf });
  const b = await restoreVaultSession("hunter2", { version: 2, kdf });
  checkEq("same password + kdf -> same authToken", a.authToken, b.authToken);

  const otherSalt = await restoreVaultSession("hunter2", {
    version: 2,
    kdf: testKdf(),
  });
  check(
    "different salt -> different authToken",
    a.authToken !== otherSalt.authToken,
  );

  checkEq("authToken is 44 chars (32 bytes base64)", a.authToken.length, 44);
  check(
    "authToken is valid base64",
    /^[A-Za-z0-9+/]{43}=$/.test(a.authToken),
    a.authToken,
  );
}

// Case 4 — legacy v1 envelope still round-trips; no auth token.
async function case4() {
  console.log("\nCase 4: legacy v1 session");
  const kdf = testKdf();
  const v1 = await restoreVaultSession("legacy-password", { version: 1, kdf });
  checkEq("session version", v1.version, 1);
  checkEq("authToken is empty string", v1.authToken, "");

  const encrypted = await encryptVaultPayload(SAMPLE_PAYLOAD, v1);
  checkEq("envelope version", encrypted.version, 1);
  const decrypted = await decryptVaultPayload(encrypted, v1);
  checkEq(
    "v1 payload round-trips exactly",
    JSON.stringify(decrypted),
    JSON.stringify(SAMPLE_PAYLOAD),
  );

  // A v2 session from the same password + kdf uses a different key.
  const v2 = await restoreVaultSession("legacy-password", { version: 2, kdf });
  check(
    "v2 key cannot decrypt v1 ciphertext",
    await rejects(() => decryptVaultPayload(encrypted, v2)),
  );
}

// Case 5 — attachment chunk encryption: round-trip + tamper detection.
async function case5() {
  console.log("\nCase 5: encryptBytes/decryptBytes chunk round-trip");
  const session = await restoreVaultSession("chunk-password", {
    version: 3,
    kdf: testKdf(),
  });
  const context = { fileId: "file-1", chunkIndex: 0, totalChunks: 1 };

  const original = new Uint8Array(100 * 1024);
  crypto.getRandomValues(original);

  const chunk = await encryptBytes(original, session, context);
  check("chunk shape passes isEncryptedChunk", isEncryptedChunk(chunk));

  const roundTripped = await decryptBytes(chunk, session, context);
  checkEq("decrypted length", roundTripped.length, original.length);
  let equal = true;
  for (let i = 0; i < original.length; i++) {
    if (roundTripped[i] !== original[i]) {
      equal = false;
      break;
    }
  }
  check("100KB random bytes round-trip byte-for-byte", equal);

  const manifest = await createV3AttachmentManifest(
    session,
    context.fileId,
    [await encryptedChunkDigest(chunk)],
    [original.length],
  );
  const attachment = {
    id: context.fileId,
    name: "test.bin",
    mimeType: "application/octet-stream",
    size: original.length,
    thumb: "",
    createdAt: 1,
    ...manifest,
  };
  check(
    "manifest authenticates for its file",
    await verifyV3AttachmentManifest(attachment, session),
  );
  check(
    "manifest cannot be replayed for another file",
    !(await verifyV3AttachmentManifest(
      { ...attachment, id: "file-2" },
      session,
    )),
  );

  const replacement = await encryptBytes(
    new TextEncoder().encode("replacement file version"),
    session,
    context,
  );
  const replacementHash = await encryptedChunkDigest(replacement);
  const replacementManifest = await createV3AttachmentManifest(
    session,
    context.fileId,
    [replacementHash],
    ["replacement file version".length],
  );
  check(
    "previous file version is rejected by the current manifest",
    (await encryptedChunkDigest(chunk)) !== replacementHash &&
      (await verifyV3AttachmentManifest(
        { ...attachment, ...replacementManifest },
        session,
      )),
  );

  // Flip one ciphertext character (middle of the string, away from padding).
  const mid = Math.floor(chunk.ciphertext.length / 2);
  const flipped =
    chunk.ciphertext.slice(0, mid) +
    (chunk.ciphertext[mid] === "A" ? "B" : "A") +
    chunk.ciphertext.slice(mid + 1);
  check("tampered ciphertext actually differs", flipped !== chunk.ciphertext);
  check(
    "decryptBytes rejects tampered ciphertext",
    await rejects(() =>
      decryptBytes({ ...chunk, ciphertext: flipped }, session, context),
    ),
  );
  check(
    "chunk rejects a different file id",
    await rejects(() =>
      decryptBytes(chunk, session, { ...context, fileId: "file-2" }),
    ),
  );
  check(
    "chunk rejects a different position",
    await rejects(() =>
      decryptBytes(chunk, session, {
        fileId: context.fileId,
        chunkIndex: 1,
        totalChunks: 2,
      }),
    ),
  );
}

async function case6() {
  console.log("\nCase 6: hostile envelope parameters are rejected");
  const kdf = testKdf();
  check(
    "too-cheap KDF is rejected before derivation",
    await rejects(() =>
      restoreVaultSession("password", {
        version: 3,
        kdf: { ...kdf, iterations: 99_999 },
      }),
    ),
  );
  check(
    "excessive KDF is rejected before derivation",
    await rejects(() =>
      restoreVaultSession("password", {
        version: 3,
        kdf: { ...kdf, iterations: 2_000_001 },
      }),
    ),
  );
  check(
    "short salt is rejected",
    !isVaultEncryptedPayload({
      version: 3,
      format: "aes-gcm",
      kdf: { ...kdf, salt: "c2FsdA==" },
      iv: "AAAAAAAAAAAAAAAA",
      ciphertext: "AAAAAAAAAAAAAAAAAAAAAA==",
    }),
  );
}

async function main() {
  await case1();
  await case2();
  await case3();
  await case4();
  await case5();
  await case6();

  console.log(
    allPass ? "\nAll cases passed." : "\nSome checks failed — see above.",
  );
  if (!allPass) {
    throw new Error("Sanity check failed");
  }
}

await main();
