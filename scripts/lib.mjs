// 密钥与加密的公共代码。页面 index.html 里有同样算法的浏览器版本，改动时两边要一致。
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VAULT_FILE = path.join(ROOT, "data", "vault.json");
export const KEYS_FILE = path.join(ROOT, "data", "keys.json");
export const MASTER_FILE = path.join(ROOT, "private", "master.json");
export const LOG_FILE = path.join(ROOT, "private", "keys.json");

const subtle = webcrypto.subtle;
const enc = new TextEncoder();
const ECDH = { name: "ECDH", namedCurve: "P-256" };
export const PBKDF2_ROUNDS = 100000;

export const b64 = (buf) => Buffer.from(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const random = (n) => webcrypto.getRandomValues(new Uint8Array(n));

export function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 1) + "\n");
}

// 密钥：16 位 Crockford Base32（80 bit），显示为 XXXX-XXXX-XXXX-XXXX
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newKey() {
  return Array.from(random(16), (b) => ALPHABET[b & 31]).join("").match(/.{4}/g).join("-");
}

export function normalizeKey(s) {
  return String(s).toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

export const formatKey = (k) => k.match(/.{1,4}/g).join("-");

export async function sha256hex(text) {
  return Buffer.from(await subtle.digest("SHA-256", enc.encode(text))).toString("hex");
}

// 公开的 keys.json 用它做索引，找到对应的加密条目
export async function keyId(normalized) {
  return (await sha256hex("economist-audio:" + normalized)).slice(0, 20);
}

// 用密钥本身（PBKDF2）加密：主私钥 + 到期时间 + 次数上限
export async function wrapForKey(normalized, payload) {
  const salt = random(16);
  const iv = random(12);
  const base = await subtle.importKey("raw", enc.encode(normalized), "PBKDF2", false, ["deriveKey"]);
  const aes = await subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ROUNDS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, aes, enc.encode(JSON.stringify(payload)));
  return { s: b64(salt), i: b64(iv), c: b64(ct) };
}

export async function newMasterKey() {
  const pair = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const { kty, crv, x, y, d } = await subtle.exportKey("jwk", pair.privateKey);
  return { kty, crv, x, y, d };
}

// 用主公钥封装期刊列表（ECDH + HKDF + AES-GCM）；GitHub Actions 只需要公钥就能更新
export async function seal(pubJwk, text) {
  const pub = await subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: pubJwk.x, y: pubJwk.y }, ECDH, false, []);
  const eph = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "ECDH", public: pub }, eph.privateKey, 256);
  const hk = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  const aes = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("ea-vault-v1"), info: enc.encode("economist-audio") },
    hk,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const iv = random(12);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv }, aes, enc.encode(text));
  const { x, y } = await subtle.exportKey("jwk", eph.publicKey);
  return { k: { x, y }, i: b64(iv), c: b64(ct) };
}

// 仅供自测：用主私钥解开
export async function unseal(privJwk, box) {
  const priv = await subtle.importKey("jwk", privJwk, ECDH, false, ["deriveBits"]);
  const pub = await subtle.importKey("jwk", { kty: "EC", crv: "P-256", ...box.k }, ECDH, false, []);
  const bits = await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const hk = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  const aes = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("ea-vault-v1"), info: enc.encode("economist-audio") },
    hk,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  return new TextDecoder().decode(await subtle.decrypt({ name: "AES-GCM", iv: unb64(box.i) }, aes, unb64(box.c)));
}
