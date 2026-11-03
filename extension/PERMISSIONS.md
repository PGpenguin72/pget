# PGet extension — permissions / 權限說明

This file explains every permission in `manifest.json` for Chrome Web Store review.
本文件說明 `manifest.json` 中每一項權限的用途，供 Chrome 線上應用程式商店審核參考。

The extension has a single purpose: hand downloads from the browser to the PGet desktop
download manager running on the same computer. It talks **only** to `http://127.0.0.1:17890–17899`
(the PGet app). It contains no remote code, no `eval`, no analytics, and makes no requests
to any external server. The extension-page CSP enforces this: `connect-src http://127.0.0.1:*`.

擴充功能只有一個用途：把瀏覽器的下載交給同一台電腦上的 PGet 桌面下載器。它**只**和
`http://127.0.0.1:17890–17899`（PGet 桌面程式）通訊；沒有遠端程式碼、沒有 `eval`、沒有分析追蹤，
也不會連到任何外部伺服器。擴充功能頁面的 CSP 也強制限制為 `connect-src http://127.0.0.1:*`。

---

## API permissions / API 權限

| Permission | Why (English) | 用途（繁體中文） |
|---|---|---|
| `downloads` | Detect a new browser download (`onCreated`), pause it while asking PGet, then cancel/erase it **only after** PGet accepts it; otherwise resume it. Also used to restart a download in the browser when PGet is unavailable, so a download is never lost. | 偵測瀏覽器新開始的下載（`onCreated`），詢問 PGet 期間先暫停；**只有** PGet 確認接手後才取消並從清單移除，否則繼續下載。PGet 無法使用時也用它讓瀏覽器重新下載，確保下載不會遺失。 |
| `cookies` | Many downloads require the user's login session. For the one URL being handed over, the extension reads the cookies the browser would send to that URL (`chrome.cookies.getAll({ url })`) and passes them to the local PGet app so its request is authorised the same way. Cookies are never stored by the extension and never sent anywhere except `127.0.0.1`. | 許多下載需要登入狀態。擴充功能只讀取「要交出去的那一個網址」瀏覽器本來就會送出的 cookie（`chrome.cookies.getAll({ url })`），交給本機 PGet，讓它以相同身分下載。擴充功能不儲存 cookie，也只送到 `127.0.0.1`。 |
| `storage` | Save the user's settings (pause switch, size threshold, excluded sites, notifications, theme) in `storage.sync`, and the pairing token for the local PGet app in `storage.local`. | 儲存使用者設定（暫停攔截、最小檔案大小、排除網站、通知、主題）於 `storage.sync`，以及與本機 PGet 配對的 token 於 `storage.local`。 |
| `contextMenus` | Right-click items: "Download link with PGet", "Download with PGet" (on video/audio elements) and "Download video on this page with PGet". Also how `magnet:` links are sent to PGet, so no content script is needed. | 右鍵選單：「用 PGet 下載連結」「用 PGet 下載」（影片／音訊元素）「用 PGet 下載影片（此頁）」。`magnet:` 連結也透過右鍵選單送出，因此不需要內容腳本。 |
| `notifications` | Optional confirmation that a download was sent to PGet (can be turned off in settings), and error / re-pair prompts so the user knows why a download stayed in the browser. | 下載已交給 PGet 的提示（可在設定中關閉），以及錯誤／需要重新配對的提醒，讓使用者知道為什麼下載留在瀏覽器。 |

## Host permissions / 主機權限

| Host permission | Why (English) | 用途（繁體中文） |
|---|---|---|
| `http://127.0.0.1/*` | The PGet desktop app listens only on `127.0.0.1` (ports 17890–17899). The extension calls `/ping`, `/pair` and `/add` there. This is the only network destination of the extension. | PGet 桌面程式只在 `127.0.0.1`（連接埠 17890–17899）監聽。擴充功能呼叫其中的 `/ping`、`/pair`、`/add`。這是擴充功能唯一的連線目的地。 |
| `<all_urls>` | `chrome.cookies.getAll({ url })` only returns cookies for hosts the extension has host permission for. Downloads can come from any website, so without broad host permission the extension could not forward the login session and authenticated downloads would fail in PGet. **The extension does not inject scripts into pages, does not read page content, and does not make any request to these sites itself.** It is also used for `tab.url` of the page the user right-clicked (referrer / "download video on this page"). | `chrome.cookies.getAll({ url })` 只會回傳擴充功能具有主機權限之網站的 cookie。下載可能來自任何網站，若沒有這項權限就無法帶上登入狀態，需要登入的下載在 PGet 會失敗。**擴充功能不會在網頁中注入腳本、不讀取網頁內容，也不會自行連線到這些網站。** 另外也用來取得使用者按右鍵的那個分頁網址（作為 referrer／「下載此頁影片」）。 |

## Not requested / 沒有要求的權限

- No content scripts, no `scripting`, no `tabs`, no `webRequest`, no `history`, no `activeTab`.
- 不使用內容腳本，也不要求 `scripting`、`tabs`、`webRequest`、`history`、`activeTab`。

## Private (incognito) windows / 無痕視窗

Downloads from incognito windows are never intercepted, even if the user allows the extension in incognito.
即使使用者允許擴充功能在無痕模式執行，無痕視窗的下載也一律不攔截。
