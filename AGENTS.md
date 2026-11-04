# AGENTS.md

給在這個 repo 工作的 AI 程式助理（Claude Code、Codex、Copilot 等）看的說明。

## 專案是什麼

PGet：開源多線路下載器。桌面程式（Electron）負責介面，實際下載交給 aria2c（HTTP／FTP／BT）與 yt-dlp（影片網站），兩者都以子程序方式執行，透過 aria2 的 JSON-RPC 溝通。瀏覽器擴充功能攔截下載後，經由 `127.0.0.1` 上的本機 HTTP 端點交給桌面程式。

## 目錄

- `app/`：Electron 主程式（`main.js`）、preload、介面（`renderer/`）
- `extension/`：Manifest V3 擴充功能（Chrome／Edge／Firefox；`extension/scripts/build.mjs` 產生各瀏覽器版本，只有 manifest 不同）
- `site/`：官網 pget.pg72.tw，`site/public/` 是純靜態檔，用 `wrangler deploy` 部署
- `scripts/`：開發腳本

## 規則（重要）

1. **絕對不要加入任何遙測、分析、廣告、代理 SDK 或第三方追蹤。** 這是整個專案存在的理由。
2. 本機端點只能綁 `127.0.0.1`，不可以綁 `0.0.0.0`。所有來自擴充功能的請求都要驗證 token。
3. 擴充功能的權限要維持最少，新增權限前要在 PR 說明原因（Chrome 線上應用程式商店與 Firefox 附加元件審核會看）。
4. 修改資料處理方式時，同步更新五種語言的 `site/src/locales/*.mjs` 裡的 privacy 段落。
5. 不要把 `aria2c.exe`、`yt-dlp.exe` 提交進 repo；它們由 `scripts/fetch-engines.mjs` 下載並驗證雜湊。
6. 介面文字以**繁體中文**為主，並同步支援 `en`、`zh-CN`、`ja`、`ko`；新增字串時五種語言都要補。
8. 介面都要支援白色／深色主題（預設跟系統）。
9. 必須能在 Windows、macOS、Linux 上執行，路徑與子程序處理不可寫死 Windows 行為。
10. 聯絡方式：問題回報走 GitHub Issues；其他事情寄 developer@pg72.tw。
7. 程式風格：原生 JavaScript（ES modules），不引入框架，除非真的必要。

## 常用指令

```sh
node scripts/fetch-engines.mjs   # 下載引擎
cd app && npm start              # 開發模式執行
cd site && npx wrangler dev      # 本機預覽官網
cd site && npx wrangler deploy   # 部署官網
```
