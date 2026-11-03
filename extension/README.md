# PGet 瀏覽器擴充功能（Chrome／Edge，Manifest V3）

把瀏覽器的下載交給本機的 PGet 桌面程式。只和 `127.0.0.1` 通訊，沒有遠端程式碼、沒有分析追蹤。
通訊協定見 [`../docs/protocol.md`](../docs/protocol.md)；權限說明見 [`PERMISSIONS.md`](PERMISSIONS.md)；商店上架資料見 [`STORE_LISTING.md`](STORE_LISTING.md)。

## 開發時載入

1. `chrome://extensions`（Edge：`edge://extensions`）→ 開啟「開發人員模式」
2. 「載入未封裝項目」→ 選 `extension/` 資料夾
3. 開 PGet 桌面程式 → 點擴充功能圖示 →「配對」→ 在 PGet 視窗按允許

## 檔案

| 檔案 | 內容 |
|---|---|
| `manifest.json` | MV3 manifest；`default_locale` 為 `zh_TW` |
| `background.js` | Service worker：攔截下載、右鍵選單、配對 |
| `lib/pget-client.js` | 協定用戶端：探測 17890–17899、`/ping`、`/pair`、`/add`；401 時清掉 token |
| `lib/settings.js` | 設定預設值與 storage 存取 |
| `lib/i18n.js`, `lib/theme.js` | 介面翻譯、淺色／深色主題 |
| `popup.*`, `options.*`, `styles/` | 工具列視窗與設定頁 |
| `_locales/` | zh_TW、en、zh_CN、ja、ko |
| `icons/` | `icon.svg` 與 16/32/48/128 PNG（`scripts/make-icons.py` 產生） |
| `scripts/check-i18n.mjs` | 驗證 manifest 與翻譯鍵：`node extension/scripts/check-i18n.mjs` |

## 攔截流程（不讓使用者掉下載）

1. `downloads.onCreated` 收到新下載。
2. 先做本機檢查：只處理 `http(s)`（`blob:`、`data:`、`file:` 放行）、未開「暫停攔截」、不在排除網站（比對下載網址、最終網址、referrer 的網域與子網域）、大小已知且 ≥ 門檻（預設 1 MB）、已配對、不是無痕視窗、不是本擴充功能自己發起的下載。不符合就完全不碰。
3. 符合的下載先**暫停**（不是取消），取 cookie（只取該網址：`chrome.cookies.getAll({ url })`）、User-Agent、referrer，POST `/add`。
4. PGet 回 200 才**取消並從下載清單移除**；任何失敗（沒開、逾時、401、格式錯）都**繼續下載**。無法繼續時用 `downloads.download()` 重新下載；這種下載的 `byExtensionId` 是自己，第 2 步會跳過，不會無限迴圈。
5. 401 → 清掉 token、顯示「需要重新配對」通知與圖示上的 `!`。

為什麼不用 `onDeterminingFilename`：它會卡住所有下載的檔名決定流程、可能和其他下載類擴充功能衝突，而 `onCreated` 已經提供網址、大小與 MIME，檔名在暫停後再查一次即可。

## 磁力連結與內容腳本

**沒有使用內容腳本。** 點 `magnet:` 連結會直接交給作業系統的協定處理程式（PGet 安裝時可註冊），瀏覽器的 downloads API 看不到它，所以磁力連結改由右鍵選單「用 PGet 下載連結」送出。這樣就不必要求在所有網頁注入腳本，權限最少。

## 已知限制

- 「按住 Alt 點擊放行」無法在不注入腳本的情況下偵測，以「暫停攔截」開關代替（協定文件允許）。
- 由 POST 表單觸發的下載，PGet 只能用 GET 重新請求，可能失敗；遇到這種網站請加進排除清單。
- 交出去的網址是重新導向後的最終網址（`finalUrl`），cookie 也只取該網址的。
- 「下載此頁影片」與 `blob:` 影片會送出分頁網址並標 `kind: "video"`，由 PGet／yt-dlp 判斷是否支援。

## 隱私

設定存在 `chrome.storage.sync`，配對 token 存在 `chrome.storage.local`（只屬於這台電腦）。cookie 不儲存，只在交出下載時讀一次並送到 `127.0.0.1`。修改資料處理方式時請同步更新官網隱私權政策（https://pget.pg72.tw/privacy/）。
