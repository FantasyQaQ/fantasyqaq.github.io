#!/usr/bin/env node
// 从 The-Economist-Audio-List 同步期刊列表，用主公钥加密后写入 data/vault.json。
// 用法：node scripts/sync.mjs [额外年份...]
import { VAULT_FILE, readJSON, writeJSON, seal, sha256hex } from "./lib.mjs";

const SOURCE = "https://jingking.github.io/The-Economist-Audio-List/searchEditions{}.json";

async function fetchYear(year) {
  const res = await fetch(SOURCE.replace("{}", year), { headers: { "User-Agent": "economist-audio-sync" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const byDate = new Map();
  for (const edge of data?.data?.searchEditions?.edges ?? []) {
    const node = edge?.node ?? {};
    const date = String(node.issueDate ?? "").slice(0, 10);
    const id = String(node.tegId ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[a-z0-9]+$/.test(id)) continue;
    byDate.set(date, { date, title: String(node.headline ?? "").trim(), id });
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

const vault = readJSON(VAULT_FILE, null);
if (!vault?.pub) {
  console.error("还没有初始化：先运行 node scripts/keys.mjs init");
  process.exit(1);
}
vault.years ??= {};

const wanted = new Set([...Object.keys(vault.years), String(new Date().getUTCFullYear()), ...process.argv.slice(2)]);
let changed = false;
for (const year of [...wanted].sort()) {
  let issues;
  try {
    issues = await fetchYear(year);
  } catch (err) {
    console.log(`${year}: 同步失败，保留原有数据（${err.message}）`);
    continue;
  }
  const old = vault.years[year];
  if (!issues.length || (old && issues.length < old.n)) {
    console.log(`${year}: 上游只有 ${issues.length} 期，少于现有 ${old?.n ?? 0} 期，保留原有数据`);
    continue;
  }
  const text = JSON.stringify(issues);
  const h = (await sha256hex(text)).slice(0, 16);
  if (old?.h === h) {
    console.log(`${year}: 无变化（${issues.length} 期）`);
    continue;
  }
  vault.years[year] = { n: issues.length, h, ...(await seal(vault.pub, text)) };
  changed = true;
  console.log(`${year}: ${issues.length} 期，最新 ${issues[0].date}`);
}

if (changed) {
  vault.updated = new Date().toISOString().slice(0, 10);
  vault.years = Object.fromEntries(Object.entries(vault.years).sort(([a], [b]) => b.localeCompare(a)));
  writeJSON(VAULT_FILE, vault);
}
