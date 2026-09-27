#!/usr/bin/env node
// 密钥管理（只在站长电脑上运行；private/ 不会上传）
//   node scripts/keys.mjs init                       首次：生成主密钥
//   node scripts/keys.mjs new [天数] [次数] [备注]     生成一个新密钥（默认 30 天 / 20 次）
//   node scripts/keys.mjs list                       查看所有密钥
//   node scripts/keys.mjs revoke <密钥>               作废一个密钥
//   node scripts/keys.mjs limit <密钥> <次数>          修改下载次数
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import {
  VAULT_FILE, KEYS_FILE, MASTER_FILE, LOG_FILE,
  readJSON, writeJSON, newKey, normalizeKey, formatKey, keyId, wrapForKey, newMasterKey,
} from "./lib.mjs";

const DAY = 86400000;
const PRUNE_AFTER = 60 * DAY; // 过期超过 60 天的密钥从公开文件里删掉
const fmt = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 16).replace("T", " ");

function loadMaster() {
  const master = readJSON(MASTER_FILE, null);
  if (!master?.jwk) {
    console.error("找不到 private/master.json，请先运行 init（或从备份恢复）");
    process.exit(1);
  }
  return master.jwk;
}

async function init() {
  if (fs.existsSync(MASTER_FILE)) {
    console.error("已经初始化过了。重新初始化会让所有已发出的密钥失效，如确需重来请先手动删除 private/master.json");
    process.exit(1);
  }
  const jwk = await newMasterKey();
  writeJSON(MASTER_FILE, { created: new Date().toISOString(), jwk });
  const { kty, crv, x, y } = jwk;
  writeJSON(VAULT_FILE, { pub: { kty, crv, x, y }, updated: null, years: {} });
  writeJSON(KEYS_FILE, {});
  writeJSON(LOG_FILE, []);
  console.log("已生成主密钥 private/master.json —— 请备份这个文件，丢了就无法再发新密钥。");
}

async function create(days = "30", max = "20", ...noteParts) {
  const d = Number(days);
  const m = Number(max);
  if (!Number.isFinite(d) || d <= 0 || !Number.isInteger(m) || m <= 0) {
    console.error("天数和次数都要是正数");
    process.exit(1);
  }
  const jwk = loadMaster();
  const now = Date.now();
  const key = newKey();
  const norm = normalizeKey(key);
  const id = await keyId(norm);
  const exp = now + d * DAY;

  const log = readJSON(LOG_FILE, []);
  const pub = readJSON(KEYS_FILE, {});
  pub[id] = await wrapForKey(norm, { d: jwk, e: exp, m, t: now });
  for (const entry of log) {
    if (entry.exp < now - PRUNE_AFTER) delete pub[entry.id];
  }
  log.push({ key, id, note: noteParts.join(" "), created: now, exp, max: m });
  writeJSON(KEYS_FILE, pub);
  writeJSON(LOG_FILE, log);

  if (process.platform === "darwin") spawnSync("pbcopy", { input: key });
  console.log(`\n  新密钥：${key}${process.platform === "darwin" ? "（已复制到剪贴板）" : ""}`);
  console.log(`  有效期至 ${fmt(exp)}（北京时间），可下载 ${m} 期\n`);
}

function list() {
  const log = readJSON(LOG_FILE, []);
  const pub = readJSON(KEYS_FILE, {});
  if (!log.length) return console.log("还没有发过密钥");
  const now = Date.now();
  for (const e of log) {
    const status = e.revoked ? "已作废" : !pub[e.id] ? "已清理" : e.exp < now ? "已过期" : "有效";
    console.log(`${e.key}  ${status.padEnd(3, "　")}  到期 ${fmt(e.exp)}  ${String(e.max).padStart(3)} 次  ${e.note || ""}`);
  }
  console.log("\n（下载次数记在用户自己的浏览器里，这里看不到用了多少）");
}

async function revoke(input) {
  const norm = normalizeKey(input ?? "");
  if (norm.length !== 16) {
    console.error("请输入完整的 16 位密钥");
    process.exit(1);
  }
  const id = await keyId(norm);
  const pub = readJSON(KEYS_FILE, {});
  const log = readJSON(LOG_FILE, []);
  const entry = log.find((e) => e.id === id);
  if (!pub[id]) {
    console.error(`没有找到有效的密钥 ${formatKey(norm)}`);
    process.exit(1);
  }
  delete pub[id];
  if (entry) entry.revoked = Date.now();
  writeJSON(KEYS_FILE, pub);
  writeJSON(LOG_FILE, log);
  console.log(`已作废 ${formatKey(norm)}${entry?.note ? `（${entry.note}）` : ""}`);
}

// 改下载次数：密钥和到期时间不变，用户下次打开网页自动生效
async function limit(input, max) {
  const norm = normalizeKey(input ?? "");
  const m = Number(max);
  if (norm.length !== 16 || !Number.isInteger(m) || m <= 0) {
    console.error("用法：limit <16 位密钥> <新的次数>");
    process.exit(1);
  }
  const id = await keyId(norm);
  const pub = readJSON(KEYS_FILE, {});
  const log = readJSON(LOG_FILE, []);
  const entry = log.find((e) => e.id === id);
  if (!pub[id] || !entry) {
    console.error(`没有找到有效的密钥 ${formatKey(norm)}`);
    process.exit(1);
  }
  pub[id] = await wrapForKey(norm, { d: loadMaster(), e: entry.exp, m, t: entry.created });
  const old = entry.max;
  entry.max = m;
  writeJSON(KEYS_FILE, pub);
  writeJSON(LOG_FILE, log);
  console.log(`${formatKey(norm)}：下载次数 ${old} → ${m}，有效期仍到 ${fmt(entry.exp)}`);
}

const [cmd, ...args] = process.argv.slice(2);
const commands = { init, new: create, list, revoke, limit };
if (!commands[cmd]) {
  console.error("用法：keys.mjs init | new [天数] [次数] [备注] | list | revoke <密钥> | limit <密钥> <次数>");
  process.exit(1);
}
await commands[cmd](...args);
