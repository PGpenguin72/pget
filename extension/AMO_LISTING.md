# Firefox 附加元件（addons.mozilla.org）上架資料

給上架到 [addons.mozilla.org](https://addons.mozilla.org/)（AMO）用。Chrome／Edge 的資料在 [`STORE_LISTING.md`](STORE_LISTING.md)，權限說明在 [`PERMISSIONS.md`](PERMISSIONS.md)。

| 欄位 | 值 |
|---|---|
| 附加元件 ID | `pget@pg72.tw`（寫在 Firefox 版 manifest 的 `browser_specific_settings.gecko.id`，上架後不能改） |
| 最低版本 | Firefox 140.0（桌面版）。Android 版不支援（沒有完整的 downloads API） |
| 上傳檔案 | `pget-extension-firefox-X.Y.Z.zip`（GitHub Actions「Extension」工作流程產生） |
| 隱私權政策網址 | **https://pget.pg72.tw/privacy/** |
| 官網（Homepage） | **https://pget.pg72.tw** |
| 支援網站（Support site） | https://github.com/PGpenguin72/pget/issues |
| 支援信箱（Support email） | developer@pg72.tw |
| 授權（License） | MIT License |
| 類別（Categories） | Download Management（下載管理） |
| 標籤（Tags） | download manager, downloads, privacy（可選） |
| 資料收集 | 不收集（manifest 已宣告 `data_collection_permissions.required: ["none"]`） |
| 語言 | 預設 繁體中文（zh_TW），另有 English、简体中文、日本語、한국어（名稱與簡短說明由 `_locales` 自動帶入） |

---

## 上架步驟

1. **產生 zip**：推 tag `ext-v0.2.0`（或在 GitHub Actions 手動執行「Extension」），下載產出的 artifact，裡面的 `pget-extension-firefox-0.2.0.zip` 就是要上傳的檔案。
   本機也可以：`node extension/scripts/build.mjs firefox`，再把 `dist/extension/firefox/` **裡面的檔案**壓成 zip（`manifest.json` 要在 zip 最上層，不能多包一層資料夾）。
2. **註冊開發者帳號**：用 Firefox 帳號登入 <https://addons.mozilla.org/developers/>，第一次會要求同意開發者協議。
3. **Submit a New Add-on** → 選 **On this site**（在 AMO 上公開發布）→ 上傳 zip。
   - 自動驗證應該是 0 error。會看到 1 個警告：`strict_min_version` 140 低於 Firefox for Android 支援 `data_collection_permissions` 的 142。我們不支援 Android，可以忽略。
4. **Compatibility（平台）**：只勾 **Firefox**（桌面版），**不要勾 Firefox for Android**。
5. **Source code（是否用了程式碼產生器、壓縮或打包工具）**：選 **No**。zip 裡的 JavaScript 就是 GitHub 上的原始碼，沒有壓縮或轉譯；`build.mjs` 只是複製檔案並改寫 `manifest.json`。（在下方「給審核者的備註」也有說明。）
6. **Describe Add-on（商店資料）**：把下面的英文或中文文字貼到對應欄位。AMO 可以切換語言分別填寫（「Translate」或欄位旁的語言選單），建議至少填 English 與 繁體中文。
   - Name：留空或照填（manifest 會帶入 `PGet Download Catcher`／`PGet 下載接手`）。
   - Add-on URL（slug）：建議 `pget`（若被用走就 `pget-download-catcher`）。
   - Summary：貼「簡短說明」。
   - Description：貼「完整說明」。
   - Categories：Download Management。
   - Support email／Support website／Homepage：見上表。
   - License：MIT License。
   - Privacy Policy：勾選「This add-on has a privacy policy」，貼上「隱私權政策」那一段，並附上網址 https://pget.pg72.tw/privacy/。
   - Notes to Reviewer：貼「給審核者的備註」（英文）。
7. **上傳圖片**：圖示會從 manifest 帶入；截圖可以用 `docs/store/screenshot-1.png`、`screenshot-2.png`（AMO 建議 1280×800，其他尺寸也可以）。
8. 送出後等待審核（通常幾天內）。**已上架**：<https://addons.mozilla.org/firefox/addon/pget/>。官網的商店按鈕讀 `site/build.mjs` 的 `FIREFOX_STORE`；`README.md`、`extension/PERMISSIONS.md`、`site/src/static/agents.md`、`site/src/static/llms.txt` 也都寫了這個連結。
9. 之後每次更新：manifest 版本號升一號 → 推 `ext-vX.Y.Z` tag → 在 AMO 的附加元件頁面「Upload New Version」上傳新的 firefox zip（ID 不變）。

---

## English

### Summary（≤250 characters）
Hands browser downloads to the PGet multi-connection download manager on your computer. Open source, no tracking, talks only to 127.0.0.1.

### Description
PGet is a free, open-source (MIT) multi-connection download manager for Windows, macOS and Linux. This add-on connects Firefox to the PGet desktop app so downloads are faster and resumable.

**What it does**
- When you start a download, the add-on hands it to PGet instead of the browser.
- Optional, off by default: "Send sign-in cookies with downloads" also passes the cookies for that one URL (only to 127.0.0.1), so downloads that need you to be signed in still work. Firefox asks for permission only when you turn it on. Container tabs keep their own cookies.
- Right-click any link → "Download link with PGet" (http, https and magnet links).
- Right-click a video or audio element → "Download with PGet".
- Right-click a page → "Download video on this page with PGet" (PGet uses yt-dlp for supported video sites).
- Small files (under 1 MB by default), excluded sites, private-window downloads, and anything while "Pause interception" is on stay in Firefox.
- If PGet is not running or something goes wrong, your download simply continues in Firefox. Nothing is lost.

**Privacy**
- The add-on only talks to the PGet app on your own computer at 127.0.0.1. It never sends data to any external server.
- No analytics, no tracking, no ads, no remote code.
- Source code: https://github.com/PGpenguin72/pget

**Requires the PGet desktop app (free):** https://pget.pg72.tw
First use: open the add-on popup, click "Pair", then click "Allow" in the PGet window.

### Privacy policy
PGet does not collect, store or share any personal data, and has no server that receives your data. The add-on only reads information about a download when you start one (the download URL, file name, file size and the page it came from) and, only if you turn on the optional "Send sign-in cookies with downloads" setting, the cookies for that one download URL. This information is sent only to the PGet desktop app on your own computer (http://127.0.0.1) so it can perform the download. It is never sent to the developer or any third party. Settings are stored in Firefox's extension storage; the pairing token stays on this computer. Full policy: https://pget.pg72.tw/privacy/

### Notes to reviewer
- Purpose: send browser downloads to the PGet desktop download manager running on the same computer. The add-on's only network destination is the local app at http://127.0.0.1:17890-17899 (enforced by the extension-page CSP `connect-src 'self' http://127.0.0.1:*`; 'self' only covers the add-on's own packaged files, e.g. the translation chosen in the options page). No remote code, no eval, no analytics, no content scripts.
- The code is not minified, bundled or transpiled. The source is https://github.com/PGpenguin72/pget (folder `extension/`). The Firefox package is produced by `node extension/scripts/build.mjs firefox`, which only copies the files and rewrites manifest.json (background.scripts instead of service_worker, browser_specific_settings). No npm dependencies are used at runtime.
- Interception: `downloads.onCreated` → pause the download → POST it to the local app → cancel and erase the browser download only after the app accepts it; on any failure the download is resumed (or restarted with `downloads.download`). Private-window downloads are never touched.
- `cookies` + optional host permission `<all_urls>`: off by default. Requested at runtime with `permissions.request` only when the user enables "Send sign-in cookies with downloads" in the options page; `cookies.getAll({ url, storeId })` then reads cookies for the single download URL and passes them only to 127.0.0.1. Disabling the option removes the permission.
- `data_collection_permissions: none` because nothing leaves the user's device.
- Testing: the add-on needs the PGet desktop app (https://pget.pg72.tw, or build from the repo). Without it, the popup shows "PGet is not running" and every download stays in Firefox, which is the expected fallback.

---

## 繁體中文

### 簡短說明（≤250 字元）
把瀏覽器的下載交給本機的 PGet 多線路下載器。開源、無追蹤，只和 127.0.0.1 通訊。

### 完整說明
PGet 是免費、開源（MIT 授權）的多線路下載器，支援 Windows、macOS、Linux。這個附加元件把 Firefox 接到 PGet 桌面程式，讓下載更快，也能斷點續傳。

**功能**
- 開始下載時，自動交給 PGet 而不是瀏覽器。
- 選用功能（預設關閉）：「下載時附上登入 cookie」會一併附上「該網址」的 cookie（只送到 127.0.0.1），需要登入才能下載的檔案也沒問題；只有開啟時 Firefox 才會詢問權限。容器分頁的 cookie 不會混在一起。
- 在連結上按右鍵 →「用 PGet 下載連結」（支援 http、https 與 magnet 磁力連結）。
- 在影片或音訊上按右鍵 →「用 PGet 下載」。
- 在網頁上按右鍵 →「用 PGet 下載影片（此頁）」（支援的影片網站由 PGet 透過 yt-dlp 下載）。
- 小檔案（預設小於 1 MB）、排除的網站、隱私視窗的下載，以及開啟「暫停攔截」時，下載都留在 Firefox。
- PGet 沒開或發生任何錯誤時，下載會繼續由 Firefox 完成，不會遺失。

**隱私**
- 附加元件只和你自己電腦上的 PGet（127.0.0.1）通訊，不會把任何資料送到外部伺服器。
- 沒有分析、沒有追蹤、沒有廣告、沒有遠端程式碼。
- 原始碼：https://github.com/PGpenguin72/pget

**需要安裝 PGet 桌面程式（免費）：** https://pget.pg72.tw
第一次使用：打開附加元件視窗按「配對」，再到 PGet 視窗按「允許」。

### 隱私權政策
PGet 不收集、不儲存、也不分享你的任何個人資料，也沒有接收你資料的伺服器。附加元件只在你開始下載時讀取該下載的資訊（下載網址、檔名、檔案大小與來源網頁），以及只有在你開啟選用的「下載時附上登入 cookie」時，讀取該下載網址的 cookie。這些資訊只送到你自己電腦上的 PGet 桌面程式（http://127.0.0.1）來執行下載，不會送給開發者或任何第三方。設定存在 Firefox 的擴充功能儲存空間，配對 token 只留在這台電腦。完整政策：https://pget.pg72.tw/privacy/
