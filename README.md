# 经济学人音频下载

纯静态页面：输入密钥后列出每期经济学人周刊，点「下载」直接从官方服务器下载整期音频（zip），不跳转页面。

## 密钥怎么起作用

- 期刊列表用主公钥加密存在 `data/vault.json`，没有有效密钥看不到内容。
- 每个密钥在 `data/keys.json` 里有一条用它自己加密的记录，里面是解密用的主私钥、到期时间和下载次数上限。
- 到期时间按 GitHub 服务器时间判断；下载次数记在用户浏览器里（同一期重复下载不扣次数）。
- 这是纯前端方案：挡得住普通访客，挡不住会读代码的人。

## 文件

- `index.html` — 页面
- `data/vault.json` / `data/keys.json` — 加密后的期刊列表 / 密钥记录（公开）
- `private/` — 主私钥和密钥明细，**只在本机，不会上传，务必备份**
- `scripts/keys.mjs` — 生成、查看、作废密钥
- `scripts/sync.mjs` — 同步期刊列表（`.github/workflows/sync.yml` 每周五、六自动运行）

## 命令

```bash
node scripts/keys.mjs new 30 20 备注   # 新密钥：30 天、20 次
node scripts/keys.mjs list
node scripts/keys.mjs revoke XXXX-XXXX-XXXX-XXXX
node scripts/sync.mjs 2025             # 加入 2025 年
```

列表来源：[The-Economist-Audio-List](https://github.com/jingking/The-Economist-Audio-List)。
