/**
 * Extract private key from geth keystore file.
 * Usage: JOULE_PASSWORD=xxx node scripts/extract-key.cjs
 *
 * Outputs the private key to use in hardhat.config.cjs
 * WARNING: Only use for testnet. Never store mainnet keys in config files.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const keystoreDir = path.join(__dirname, "../../data/testnet/keystore");
const files = fs.readdirSync(keystoreDir);
if (files.length === 0) { console.error("No keystore files found"); process.exit(1); }

const keystoreFile = path.join(keystoreDir, files[0]);
const keystore = JSON.parse(fs.readFileSync(keystoreFile, "utf8"));

const password = process.env.JOULE_PASSWORD;
if (!password) { console.error("Set JOULE_PASSWORD env var"); process.exit(1); }

// Decrypt using scrypt or pbkdf2
const kdfparams = keystore.crypto.kdfparams;
let derivedKey;

if (keystore.crypto.kdf === "scrypt") {
  derivedKey = crypto.scryptSync(
    Buffer.from(password),
    Buffer.from(kdfparams.salt, "hex"),
    kdfparams.dklen,
    { N: kdfparams.n, r: kdfparams.r, p: kdfparams.p }
  );
} else {
  derivedKey = crypto.pbkdf2Sync(
    Buffer.from(password),
    Buffer.from(kdfparams.salt, "hex"),
    kdfparams.c,
    kdfparams.dklen,
    "sha256"
  );
}

// Verify MAC
const ciphertext = Buffer.from(keystore.crypto.ciphertext, "hex");
const mac = crypto.createHash("sha3-256")
  .update(Buffer.concat([derivedKey.slice(16, 32), ciphertext]))
  .digest("hex");

// keccak256 — use the native keccak
const { createHash } = require("crypto");
function keccak256(data) {
  return createHash("sha3-256").update(data).digest("hex");
}

const computedMac = keccak256(Buffer.concat([derivedKey.slice(16, 32), ciphertext]));
if (computedMac !== keystore.crypto.mac) {
  console.error("Wrong password — MAC mismatch");
  process.exit(1);
}

// Decrypt
const decipher = crypto.createDecipheriv(
  keystore.crypto.cipher,
  derivedKey.slice(0, 16),
  Buffer.from(keystore.crypto.cipherparams.iv, "hex")
);
const privateKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
console.log("0x" + privateKey.toString("hex"));
