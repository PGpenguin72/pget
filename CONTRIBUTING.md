# 參與貢獻 PGet

謝謝你願意幫忙！PGet 是一個開源、免費、**沒有夾帶任何東西**的多線路下載器，任何大小的貢獻都很歡迎：回報錯誤、提建議、改翻譯、修文件、寫程式都可以。

[English below](#contributing-to-pget)

## 聯絡方式

- **錯誤回報、功能建議**：請先開 [GitHub Issue](https://github.com/PGpenguin72/pget/issues)
- **安全性問題**：請**不要**公開，看 [SECURITY.md](SECURITY.md)
- **其他事情**（合作、授權等）：寄信到 <developer@pg72.tw>

## 最重要的規則

1. **絕對不加入任何遙測、分析、廣告、代理 SDK 或第三方追蹤。** 這是 PGet 存在的理由，這類 PR 不會被接受。
2. 本機端點只能綁 `127.0.0.1`，來自擴充功能的請求都要驗證 token（見 [docs/protocol.md](docs/protocol.md)）。
3. 擴充功能權限維持最少；要新增權限，請在 PR 說明原因。
4. 改到資料處理方式時，同步更新隱私權政策（`site/`）。
5. 不要提交 `aria2c`、`yt-dlp` 等執行檔；它們由 `scripts/fetch-engines.mjs` 下載並驗證雜湊。

## 開發環境

需要 Node.js 22 以上。

```sh
git clone https://github.com/PGpenguin72/pget.git
cd pget
node scripts/fetch-engines.mjs     # 下載 aria2c 與 yt-dlp 到 app/bin/
cd app && npm install && npm start # 桌面程式
```

- **擴充功能**：Chrome／Edge 打開 `chrome://extensions`，開啟「開發人員模式」，「載入未封裝項目」選 `extension/` 資料夾
- **官網**：`cd site && npm install && npx wrangler dev`

## 送出 PR 之前

```sh
node ci/check-syntax.mjs                 # 所有 JS 語法檢查
node extension/scripts/check-i18n.mjs    # 擴充功能翻譯是否齊全
cd site && npm run build                 # 官網能不能建置
```

CI 會跑一樣的檢查。

## 程式風格

- 原生 JavaScript（ES modules），除非真的必要，不引入框架
- 縮排 2 個空格、LF 換行（`.editorconfig` 已設定）
- 介面文字以**繁體中文**為主；新增字串時也請補上其他語言（不會寫可以先留英文，在 PR 註明）
- Commit 訊息簡短說明「做了什麼」，中英文都可以

## 翻譯

- 擴充功能：`extension/_locales/<語言>/messages.json`
- 官網：`site/src/locales/<語言>.mjs`

翻譯 PR 非常歡迎，尤其是母語者的潤稿。

## 授權

送出貢獻即表示你同意以 [MIT 授權](LICENSE) 釋出你的程式碼。

---

# Contributing to PGet

Thanks for helping! PGet is a free, open-source multi-connection download manager that **bundles nothing**. Bug reports, ideas, translations, docs and code are all welcome.

## Contact

- **Bugs and feature requests**: open a [GitHub Issue](https://github.com/PGpenguin72/pget/issues) first
- **Security issues**: do **not** post publicly; see [SECURITY.md](SECURITY.md)
- **Anything else**: <developer@pg72.tw>

## Ground rules

1. **No telemetry, analytics, ads, proxy SDKs or third-party trackers. Ever.** PRs adding them will be closed.
2. The local endpoint binds to `127.0.0.1` only, and every extension request must carry a valid token ([docs/protocol.md](docs/protocol.md)).
3. Keep extension permissions minimal; explain any new permission in the PR.
4. Update the privacy policy (`site/`) when data handling changes.
5. Never commit engine binaries (`aria2c`, `yt-dlp`); `scripts/fetch-engines.mjs` downloads and hash-checks them.

## Setup

Node.js 22+ is required.

```sh
node scripts/fetch-engines.mjs
cd app && npm install && npm start
```

Load `extension/` as an unpacked extension in `chrome://extensions` (Developer mode). Preview the site with `cd site && npm install && npx wrangler dev`.

## Before opening a PR

```sh
node ci/check-syntax.mjs
node extension/scripts/check-i18n.mjs
cd site && npm run build
```

Style: plain JavaScript (ES modules), no frameworks unless truly necessary, 2-space indent, LF line endings. UI text is Traditional Chinese first; please add new strings to every locale (English placeholders are fine, just mention it in the PR).

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
