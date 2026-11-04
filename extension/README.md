# PGet 瀏覽器擴充功能（Chrome／Edge／Firefox，Manifest V3）

把瀏覽器的下載交給本機的 PGet 桌面程式。只和 `127.0.0.1` 通訊，沒有遠端程式碼、沒有分析追蹤。
通訊協定見 [`../docs/protocol.md`](../docs/protocol.md)；權限說明見 [`PERMISSIONS.md`](PERMISSIONS.md)；商店上架資料見 [`STORE_LISTING.md`](STORE_LISTING.md)（Chrome／Edge）與 [`AMO_LISTING.md`](AMO_LISTING.md)（Firefox）。

同一份原始碼同時產出 Chrome／Edge 版與 Firefox 版，兩者只有 `manifest.json` 不同（見下方「建置」）。

## 開發時載入

Chrome／Edge：

1. `chrome://extensions`（Edge：`edge://extensions`）→ 開啟「開發人員模式」
2. 「載入未封裝項目」→ 選 `extension/` 資料夾
3. 開 PGet 桌面程式 → 點擴充功能圖示 →「配對」→ 在 PGet 視窗按允許

Firefox（140 以上）：

1. `node extension/scripts/build.mjs firefox` → 產生 `dist/extension/firefox/`
2. `about:debugging#/runtime/this-firefox` →「載入臨時附加元件」→ 選 `dist/extension/firefox/manifest.json`
3. 同上配對。改了程式碼要重新建置再按「重新載入」

## 建置

`node extension/scripts/build.mjs` 會把 `extension/` 複製成 `dist/extension/chrome/` 與 `dist/extension/firefox/`（不含 `scripts/` 與 `*.md`）。程式碼完全相同，只有 Firefox 的 `manifest.json` 會被改寫：

- `background.service_worker` → `background.scripts`（Firefox 沒有擴充功能 service worker）
- 加上 `browser_specific_settings.gecko`：ID `pget@pg72.tw`、`strict_min_version` 140.0、`data_collection_permissions: { required: ["none"] }`（AMO 規定；資料只送到 127.0.0.1，不算收集）
- 拿掉 `minimum_chrome_version`

檢查 Firefox 版：`npx web-ext lint -s dist/extension/firefox`（必須 0 error）。打包由 `.github/workflows/extension.yml` 產生兩個 zip。

程式碼一律用 `lib/ext.js` 匯出的 `ext`（Firefox 是 `browser`，Chrome 是 `chrome`），而且只用 Promise 寫法、不傳 callback（Firefox 的 `browser.*` 不接受 callback）。

## 檔案

| 檔案 | 內容 |
|---|---|
| `manifest.json` | MV3 manifest；`default_locale` 為 `zh_TW` |
| `background.js` | 背景腳本（Chrome 是 service worker、Firefox 是背景腳本）：攔截下載、右鍵選單、配對 |
| `lib/ext.js` | `ext`（`browser` 或 `chrome`）與 `IS_FIREFOX` |
| `lib/pget-client.js` | 協定用戶端：探測 17890–17899、`/ping`、`/pair`、`/add`；401 時清掉 token |
| `lib/settings.js` | 設定預設值與 storage 存取 |
| `lib/i18n.js`, `lib/theme.js` | 介面翻譯、淺色／深色主題 |
| `popup.*`, `options.*`, `styles/` | 工具列視窗與設定頁 |
| `_locales/` | zh_TW、en、zh_CN、ja、ko |
| `icons/` | `icon.svg` 與 16/32/48/128 PNG（`scripts/make-icons.py` 產生） |
| `scripts/check-i18n.mjs` | 驗證 manifest 與翻譯鍵：`node extension/scripts/check-i18n.mjs` |
| `scripts/build.mjs` | 產生 Chrome／Firefox 兩個版本到 `dist/extension/` |

## 攔截流程（不讓使用者掉下載）

1. `downloads.onCreated` 收到新下載。
2. 先做本機檢查：只處理 `http(s)`（`blob:`、`data:`、`file:` 放行）、未開「暫停攔截」、不在排除網站（比對下載網址、最終網址、referrer 的網域與子網域）、大小已知且 ≥ 門檻（預設 1 MB）、已配對、不是無痕視窗、不是本擴充功能自己發起的下載。不符合就完全不碰。
3. 符合的下載先**暫停**（不是取消），若使用者開啟了選用的「下載時附上登入 cookie」且有 `<all_urls>` 選用權限，才取 cookie（只取該網址：`cookies.getAll({ url })`；Firefox 另外指定下載所在的容器 `storeId`）、User-Agent、referrer，POST `/add`。
4. PGet 回 200 才**取消並從下載清單移除**；任何失敗（沒開、逾時、401、格式錯）都**繼續下載**。無法繼續時用 `downloads.download()` 重新下載；這種下載的 `byExtensionId` 是自己，第 2 步會跳過，不會無限迴圈。
5. 401 → 清掉 token、顯示「需要重新配對」通知與圖示上的 `!`。

為什麼不用 `onDeterminingFilename`：它會卡住所有下載的檔名決定流程、可能和其他下載類擴充功能衝突，而 `onCreated` 已經提供網址、大小與 MIME，檔名在暫停後再查一次即可。Firefox 也沒有 `onDeterminingFilename`，所以這套流程在兩邊完全一樣。

## Firefox 與 Chrome 的差異

| 項目 | Chrome／Edge | Firefox |
|---|---|---|
| 背景 | service worker（module） | 非常駐背景腳本（`background.scripts`，module） |
| 最低版本 | Chrome 116 | Firefox 140（桌面版；Android 版沒有完整的 downloads API，不支援） |
| 攔截下載 | `onCreated` → 暫停 → `/add` → 取消＋清除 | 相同 |
| 最終網址 | 用 `finalUrl` | Firefox 的 DownloadItem 沒有 `finalUrl`，用 `url` |
| cookie | `cookies.getAll({ url })` | 加上下載所屬容器的 `storeId`；開了 first-party isolation 時改用 `firstPartyDomain: null` 再查一次 |
| 退回瀏覽器重新下載 | `downloads.download({ url })` | 同一個容器：`downloads.download({ url, cookieStoreId })` |
| 右鍵選單送出 | — | 用該分頁的容器取 cookie |
| 配對時的名稱 | `Chrome 131 / PGet Extension x.y.z` | `Firefox 140 / PGet Extension x.y.z` |
| Origin | `chrome-extension://<32 個 a–p>` | `moz-extension://<UUID>`（桌面程式兩種都接受） |
| 127.0.0.1 主機權限 | 安裝時取得 | 安裝時顯示並取得，但使用者可在附加元件管理員收回；收回後請求會改走 CORS（桌面程式對擴充功能 Origin 有回 CORS 標頭） |


## 磁力連結與內容腳本

**沒有使用內容腳本。** 點 `magnet:` 連結會直接交給作業系統的協定處理程式（PGet 安裝時可註冊），瀏覽器的 downloads API 看不到它，所以磁力連結改由右鍵選單「用 PGet 下載連結」送出。這樣就不必要求在所有網頁注入腳本，權限最少。

## 已知限制

- 「按住 Alt 點擊放行」無法在不注入腳本的情況下偵測，以「暫停攔截」開關代替（協定文件允許）。
- 由 POST 表單觸發的下載，PGet 只能用 GET 重新請求，可能失敗；遇到這種網站請加進排除清單。
- 交出去的網址是重新導向後的最終網址（`finalUrl`），cookie 也只取該網址的。
- 「下載此頁影片」與 `blob:` 影片會送出分頁網址並標 `kind: "video"`，由 PGet／yt-dlp 判斷是否支援。

## 隱私

設定存在 `storage.sync`，配對 token 存在 `storage.local`（只屬於這台電腦）。cookie 轉送預設關閉（`storage.local` 的 `sendCookies`），開啟時才在執行期間要求 `<all_urls>` 選用權限；cookie 不儲存，只在交出下載時讀一次並送到 `127.0.0.1`。修改資料處理方式時請同步更新官網隱私權政策（https://pget.pg72.tw/privacy/）。
