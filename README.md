# PGet 🐧

開源、免費、**沒有夾帶任何東西**的多線路下載器。

> 為什麼做這個？因為以前很好用的 EagleGet 後來夾帶了 Luminati（會把你的網路借給別人當代理），整個被防毒判成病毒。PGet 想做一個一樣好用、但乾乾淨淨的版本。

官網：<https://pget.pg72.tw>

## 功能

- **多線路併發下載**：一個檔案切成很多段同時下載，預設 32 條，最多 128 條
- **斷點續傳**：斷線、關機之後從斷掉的地方繼續
- **排隊與限速**：控制同時下載的數量與速度
- **瀏覽器自動攔截**：Chrome／Edge 擴充功能，點下載就交給 PGet，連登入狀態（cookie）一起帶過去
- **影片網站**：YouTube、Bilibili 等，可選畫質
- **BT／磁力連結**
- **Windows／macOS／Linux** 三平台
- **五種語言**：繁體中文、English、简体中文、日本語、한국어
- **白色／深色介面**，預設跟著系統

## 不會做的事

- ❌ 不收集任何資料、沒有分析追蹤
- ❌ 不需要帳號
- ❌ 不夾帶廣告、代理 SDK、挖礦或任何第三方軟體
- ❌ 不會把你的網路借給別人

## 架構

| 資料夾 | 內容 |
|---|---|
| `app/` | 桌面程式（Electron） |
| `extension/` | 瀏覽器擴充功能（Manifest V3） |
| `site/` | 官網 pget.pg72.tw（Cloudflare Workers 靜態網站） |
| `scripts/` | 開發用腳本，例如下載引擎 |

下載引擎用的是開源專案：

- [aria2](https://github.com/aria2/aria2)（[myfreeer 強化版](https://github.com/myfreeer/aria2-build-msys2)，解除每台伺服器 16 條連線的上限）：HTTP／FTP／BT／磁力
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)：影片網站

## 開發

```sh
node scripts/fetch-engines.mjs   # 下載 aria2c 與 yt-dlp 到 app/bin/
cd app && npm install && npm start
```

## 回饋

- 問題回報、功能建議：請開 [GitHub Issues](https://github.com/PGpenguin72/pget/issues)
- 其他事情：<developer@pg72.tw>

## 授權

[MIT](LICENSE) © 2026 PGpenguin72

aria2 以 GPL-2.0 授權、yt-dlp 以 Unlicense 授權，隨附時各自保留原授權。
