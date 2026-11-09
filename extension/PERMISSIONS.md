# PGet extension — permissions / 權限說明

This file explains every permission in `manifest.json` for Chrome Web Store, Edge Add-ons and
addons.mozilla.org (Firefox) review. The Chrome / Edge and Firefox builds request exactly the same permissions
(see "Firefox" at the end; the Firefox add-on is published at https://addons.mozilla.org/firefox/addon/pget/).
本文件說明 `manifest.json` 中每一項權限的用途，供 Chrome 線上應用程式商店、Edge 附加元件與 Firefox 附加元件（addons.mozilla.org）審核參考。
Chrome／Edge 版與 Firefox 版要求的權限完全相同（差異見文末「Firefox」；Firefox 附加元件已上架：https://addons.mozilla.org/firefox/addon/pget/）。

The extension has a single purpose: hand downloads from the browser to the PGet desktop
download manager running on the same computer. It talks **only** to `http://127.0.0.1:17890–17899`
(the PGet app). It contains no remote code, no `eval`, no analytics, and makes no requests
to any external server. The extension-page CSP enforces this: `connect-src 'self' http://127.0.0.1:*` (`'self'` only lets the
extension read its own packaged files, used to load the translation the user picked in the options page).

擴充功能只有一個用途：把瀏覽器的下載交給同一台電腦上的 PGet 桌面下載器。它**只**和
`http://127.0.0.1:17890–17899`（PGet 桌面程式）通訊；沒有遠端程式碼、沒有 `eval`、沒有分析追蹤，
也不會連到任何外部伺服器。擴充功能頁面的 CSP 也強制限制為 `connect-src 'self' http://127.0.0.1:*`（`'self'` 只允許讀取擴充功能自己封裝的檔案，
用來載入使用者在設定頁選的介面語言）。

---

## API permissions / API 權限

| Permission | Why (English) | 用途（繁體中文） |
|---|---|---|
| `downloads` | Detect a new browser download (`onCreated`), pause it while asking PGet, then cancel/erase it **only after** PGet accepts it; otherwise resume it. Also used to restart a download in the browser when PGet is unavailable, so a download is never lost. | 偵測瀏覽器新開始的下載（`onCreated`），詢問 PGet 期間先暫停；**只有** PGet 確認接手後才取消並從清單移除，否則繼續下載。PGet 無法使用時也用它讓瀏覽器重新下載，確保下載不會遺失。 |
| `cookies` | **Optional feature, off by default.** Some downloads require the user's login session. Only if the user turns on "Send sign-in cookies with downloads" (and grants the optional host permission below), the extension reads the cookies the browser would send to the one URL being handed over (`cookies.getAll({ url })`) and passes them to the local PGet app. Cookies are never stored by the extension and never sent anywhere except `127.0.0.1`. With the option off, no cookies are read. | **選用功能，預設關閉。** 有些下載需要登入狀態。只有在使用者開啟「下載時附上登入 cookie」（並允許下方的選用主機權限）後，擴充功能才會讀取「要交出去的那一個網址」瀏覽器本來就會送出的 cookie（`cookies.getAll({ url })`），交給本機 PGet。擴充功能不儲存 cookie，也只送到 `127.0.0.1`。選項關閉時完全不讀取 cookie。 |
| `storage` | Save the user's settings (pause switch, size threshold, excluded sites, notifications, theme, cookie option) in `storage.sync`, and the pairing token for the local PGet app in `storage.local`. | 儲存使用者設定（暫停攔截、最小檔案大小、排除網站、通知、主題、cookie 選項）於 `storage.sync`，以及與本機 PGet 配對的 token 於 `storage.local`。 |
| `contextMenus` | Right-click items: "Download link with PGet", "Download with PGet" (on video/audio elements) and "Download video on this page with PGet". Also how `magnet:` links are sent to PGet, so no content script is needed. | 右鍵選單：「用 PGet 下載連結」「用 PGet 下載」（影片／音訊元素）「用 PGet 下載影片（此頁）」。`magnet:` 連結也透過右鍵選單送出，因此不需要內容腳本。 |
| `notifications` | Optional confirmation that a download was sent to PGet (can be turned off in settings), and error / re-pair prompts so the user knows why a download stayed in the browser. | 下載已交給 PGet 的提示（可在設定中關閉），以及錯誤／需要重新配對的提醒，讓使用者知道為什麼下載留在瀏覽器。 |

## Host permissions / 主機權限

| Host permission | Why (English) | 用途（繁體中文） |
|---|---|---|
| `http://127.0.0.1/*` | The PGet desktop app listens only on `127.0.0.1` (ports 17890–17899). The extension calls `/ping`, `/pair` and `/add` there. This is the only network destination of the extension. | PGet 桌面程式只在 `127.0.0.1`（連接埠 17890–17899）監聽。擴充功能呼叫其中的 `/ping`、`/pair`、`/add`。這是擴充功能唯一的連線目的地。 |

## Optional host permission / 選用主機權限

| Optional host permission | Why (English) | 用途（繁體中文） |
|---|---|---|
| `<all_urls>` | **Not granted at install.** Declared in `optional_host_permissions` and requested at runtime (`permissions.request`) only when the user turns on "Send sign-in cookies with downloads" in the options page. `cookies.getAll({ url })` only returns cookies for hosts the extension has host permission for, and downloads can come from any website. If the user declines, the option stays off; turning the option off removes the permission again (`permissions.remove`). Before every use the extension checks `permissions.contains`; without it, downloads are sent without cookies. **The extension does not inject scripts into pages, does not read page content, and does not make any request to these sites itself.** | **安裝時不會取得。** 寫在 `optional_host_permissions`，只有使用者在設定頁開啟「下載時附上登入 cookie」時，才在執行期間以 `permissions.request` 詢問。`cookies.getAll({ url })` 只會回傳擴充功能具有主機權限之網站的 cookie，而下載可能來自任何網站。使用者拒絕時選項維持關閉；關閉選項會以 `permissions.remove` 收回權限。每次使用前都會用 `permissions.contains` 確認，沒有權限就不帶 cookie 送出。**擴充功能不會在網頁中注入腳本、不讀取網頁內容，也不會自行連線到這些網站。** |

Right-click menus use `info.linkUrl`, `info.srcUrl` and `info.pageUrl` from `contextMenus`, and downloads use `url`, `referrer` and `filename` from `downloads`; none of these need a host permission.
右鍵選單使用 `contextMenus` 提供的 `info.linkUrl`、`info.srcUrl`、`info.pageUrl`，下載使用 `downloads` 提供的 `url`、`referrer`、`filename`，這些都不需要主機權限。

## Not requested / 沒有要求的權限

- No content scripts, no `scripting`, no `tabs`, no `webRequest`, no `history`, no `activeTab`.
- 不使用內容腳本，也不要求 `scripting`、`tabs`、`webRequest`、`history`、`activeTab`。

## Private (incognito) windows / 無痕視窗

Downloads from incognito windows are never intercepted, even if the user allows the extension in incognito.
即使使用者允許擴充功能在無痕模式執行，無痕視窗的下載也一律不攔截。

## Firefox

The Firefox build (`node extension/scripts/build.mjs firefox`) uses the same code and the same permissions. Only the manifest differs:
Firefox 版（`node extension/scripts/build.mjs firefox`）程式碼與權限都相同，只有 manifest 不同：

| Manifest key | Why (English) | 用途（繁體中文） |
|---|---|---|
| `background.scripts` | Firefox runs MV3 background code as a non-persistent background script instead of a service worker. Same `background.js`. | Firefox 的 MV3 背景程式是非常駐背景腳本，不是 service worker；檔案同樣是 `background.js`。 |
| `browser_specific_settings.gecko.id` = `pget@pg72.tw` | Stable add-on ID (needed for `storage.sync` and AMO updates). | 固定的附加元件 ID（`storage.sync` 與 AMO 更新需要）。 |
| `strict_min_version` = `140.0` | First Firefox (ESR 140) that supports `data_collection_permissions`; also covers module background scripts, `storage.session` and `optional_host_permissions`. | 第一個支援 `data_collection_permissions` 的 Firefox（ESR 140）；module 背景腳本、`storage.session`、`optional_host_permissions` 也都支援。 |
| `data_collection_permissions.required` = `["none"]` | The extension collects and transmits no data to the developer or any third party. Download URLs (and, only if the user opts in, cookies) are passed to the PGet app on the same computer at `127.0.0.1` and never leave the device. | 擴充功能不會把任何資料傳給開發者或第三方。下載網址（以及使用者自己開啟時的 cookie）只交給同一台電腦 `127.0.0.1` 上的 PGet，不會離開這台裝置。 |

In Firefox the optional cookie feature reads cookies from the same container (`cookieStoreId`) as the download, so container tabs keep their separate sign-ins.
Firefox 中選用的 cookie 功能會從下載所屬的容器（`cookieStoreId`）讀取 cookie，容器分頁的登入狀態不會混在一起。
