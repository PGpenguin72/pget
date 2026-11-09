# Chrome Web Store listing / 商店上架資料

（Chrome 線上應用程式商店／Edge 附加元件用。Firefox 附加元件（addons.mozilla.org）請看 [`AMO_LISTING.md`](AMO_LISTING.md)。）

Chrome 線上應用程式商店：https://chromewebstore.google.com/detail/gffkakpdaiaeckkkbehghcpdnhlkpbdl （已填進 `site/build.mjs` 的 `CHROME_STORE`）。

Privacy policy URL / 隱私權政策網址: **https://pget.pg72.tw/privacy/**
Homepage / 官網: **https://pget.pg72.tw**
Category / 類別: Productivity / 生產力工具（Tools 工具亦可）
Language / 語言: 繁體中文（預設）、English、简体中文、日本語、한국어

---

## English

### Title
PGet Download Catcher

### Short description (≤132 chars)
Hands browser downloads to the PGet multi-connection download manager on your computer. Open source, no tracking, local only.

### Full description
PGet is a free, open-source (MIT) multi-connection download manager for Windows, macOS and Linux. This extension connects your browser to the PGet desktop app so downloads are faster and resumable.

What it does
• When you start a download, the extension hands it to PGet instead of the browser.
• Optional, off by default: "Send sign-in cookies with downloads" also passes the cookies for that one URL (only to 127.0.0.1), so downloads that need you to be signed in still work. The browser asks for permission only when you turn it on.
• Right-click any link → "Download link with PGet" (http, https and magnet links).
• Right-click a video or audio element → "Download with PGet".
• Right-click a page → "Download video on this page with PGet" (PGet uses yt-dlp for supported video sites).
• Small files (under 1 MB by default), excluded sites, and anything while "Pause interception" is on stay in the browser.
• If PGet is not running or something goes wrong, your download simply continues in the browser. Nothing is lost.

Privacy
• The extension only talks to the PGet app on your own computer at 127.0.0.1. It never sends data to any external server.
• No analytics, no tracking, no ads, no remote code.
• Source code: https://github.com/PGpenguin72/pget

Requires the PGet desktop app (free): https://pget.pg72.tw
First use: open the extension popup, click "Pair", then click "Allow" in the PGet window.

### Single purpose
Send downloads from the browser to the PGet download manager installed on the user's own computer (via 127.0.0.1).

### Permission justifications
- **downloads**: Detect new browser downloads, pause them while asking the local PGet app, and cancel/erase them only after PGet has accepted them; otherwise resume them so the download is never lost.
- **cookies**: Optional feature, off by default. Only when the user turns on "Send sign-in cookies with downloads", read the cookies the browser would send to the single URL being handed over (`chrome.cookies.getAll({url})`) and pass them to the local PGet app, so downloads that require a login still work. Cookies are not stored and are only sent to 127.0.0.1.
- **storage**: Store the user's settings and the pairing token for the local PGet app.
- **contextMenus**: Provide "Download link with PGet", "Download with PGet" and "Download video on this page with PGet"; also the way magnet links are sent, avoiding content scripts.
- **notifications**: Optional "sent to PGet" confirmation (can be turned off) and error / re-pair messages.
- **Host permission `http://127.0.0.1/*`**: The PGet app listens only on 127.0.0.1 (ports 17890–17899); this is the extension's only network destination.
- **Optional host permission `<all_urls>`** (`optional_host_permissions`, not granted at install): Requested at runtime with `chrome.permissions.request` only when the user turns on "Send sign-in cookies with downloads", because `chrome.cookies.getAll` only returns cookies for sites the extension has host access to and downloads can come from any site. If declined, the option stays off; turning the option off removes the permission. No content scripts, no page access, and no requests to these sites are made by the extension.
- **Remote code**: No, the extension does not use remote code. All JavaScript is packaged in the extension.

### Data usage disclosure (Privacy practices tab)
Data types handled:
- **Authentication information** — only if the user enables the optional cookie setting: cookies for the URL of a download being handed to PGet.
- **Web history** — the URL, referrer page URL and file name of downloads handed to PGet.

These are used **only** to perform the download in the PGet app on the user's own computer and are sent **only** to `127.0.0.1`. The developer never receives them.

Certifications:
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases.
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

---

## 繁體中文

### 名稱
PGet 下載接手

### 簡短說明（≤132 字元）
把瀏覽器的下載交給本機的 PGet 多線路下載器，連登入狀態一起帶過去。開源、無追蹤，資料只送到 127.0.0.1。

### 完整說明
PGet 是免費、開源（MIT 授權）的多線路下載器，支援 Windows、macOS、Linux。這個擴充功能把瀏覽器接到 PGet 桌面程式，讓下載更快，也能斷點續傳。

功能
• 開始下載時，自動交給 PGet 而不是瀏覽器。
• 選用功能（預設關閉）：「下載時附上登入 cookie」會一併附上「該網址」的 cookie（只送到 127.0.0.1），需要登入才能下載的檔案也沒問題；只有開啟時瀏覽器才會詢問權限。
• 在連結上按右鍵 →「用 PGet 下載連結」（支援 http、https 與 magnet 磁力連結）。
• 在影片或音訊上按右鍵 →「用 PGet 下載」。
• 在網頁上按右鍵 →「用 PGet 下載影片（此頁）」（支援的影片網站由 PGet 透過 yt-dlp 下載）。
• 小檔案（預設小於 1 MB）、排除的網站，以及開啟「暫停攔截」時，下載都留在瀏覽器。
• PGet 沒開或發生任何錯誤時，下載會繼續由瀏覽器完成，不會遺失。

隱私
• 擴充功能只和你自己電腦上的 PGet（127.0.0.1）通訊，不會把任何資料送到外部伺服器。
• 沒有分析、沒有追蹤、沒有廣告、沒有遠端程式碼。
• 原始碼：https://github.com/PGpenguin72/pget

需要安裝 PGet 桌面程式（免費）：https://pget.pg72.tw
第一次使用：打開擴充功能視窗按「配對」，再到 PGet 視窗按「允許」。

### 單一用途說明
將瀏覽器中的下載交給使用者自己電腦上安裝的 PGet 下載器（透過 127.0.0.1）。

### 權限理由
- **downloads**：偵測瀏覽器新開始的下載，詢問本機 PGet 期間先暫停；只有 PGet 確認接手後才取消並移除，否則繼續下載，確保下載不會遺失。
- **cookies**：選用功能，預設關閉。只有使用者開啟「下載時附上登入 cookie」時，才讀取「要交出去的那一個網址」瀏覽器本來就會送出的 cookie（`chrome.cookies.getAll({url})`），交給本機 PGet，讓需要登入的下載也能成功。不儲存 cookie，只送到 127.0.0.1。
- **storage**：儲存使用者設定與本機 PGet 的配對 token。
- **contextMenus**：提供「用 PGet 下載連結」「用 PGet 下載」「用 PGet 下載影片（此頁）」右鍵選單；磁力連結也由此送出，不需要內容腳本。
- **notifications**：「已交給 PGet」提示（可關閉），以及錯誤／重新配對提醒。
- **主機權限 `http://127.0.0.1/*`**：PGet 桌面程式只在 127.0.0.1（連接埠 17890–17899）監聽，這是擴充功能唯一的連線目的地。
- **選用主機權限 `<all_urls>`**（`optional_host_permissions`，安裝時不會取得）：只有使用者開啟「下載時附上登入 cookie」時，才以 `chrome.permissions.request` 在執行期間詢問。因為 `chrome.cookies.getAll` 需要對下載網址所在網站具有主機權限，而下載可能來自任何網站。使用者拒絕就維持關閉；關閉選項會收回權限。擴充功能不使用內容腳本、不讀取網頁內容，也不會自行連線到這些網站。
- **遠端程式碼**：否，沒有使用遠端程式碼，所有 JavaScript 都包含在擴充功能套件中。

### 資料使用揭露（隱私權做法分頁）
會處理的資料類型：
- **驗證資訊**：只有使用者開啟選用的 cookie 設定時，才會處理要交給 PGet 的下載網址的 cookie。
- **網路瀏覽記錄**：交給 PGet 的下載網址、來源網頁網址（referrer）與檔名。

以上資料**只**用來讓使用者自己電腦上的 PGet 執行下載，**只**送到 `127.0.0.1`，開發者完全不會收到。

聲明：
- ☑ 除核准用途外，不會將使用者資料出售或轉移給第三方。
- ☑ 不會將使用者資料用於或轉移至與單一用途無關的目的。
- ☑ 不會將使用者資料用於判斷信用或借貸用途。
