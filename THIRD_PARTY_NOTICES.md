# 第三方元件聲明 / Third-Party Notices

PGet 本身以 [MIT 授權](LICENSE) 釋出。安裝檔另外隨附以下第三方元件，它們各自保留原本的授權；PGet 只以**獨立子程序**的方式執行它們，並不與它們連結（link）。

PGet itself is MIT-licensed. Installers additionally ship the components below, each under its own licence. PGet runs the download engines as **separate processes**; it does not link against them.

---

## aria2 — GPL-2.0-or-later

- 用途 / Used for: HTTP(S)、FTP、SFTP、BitTorrent、Metalink 下載引擎（`aria2c`）
- 上游 / Upstream: <https://github.com/aria2/aria2> · 版本 / version 1.37.0
- 原始碼 / Source: <https://github.com/aria2/aria2/releases/tag/release-1.37.0>
- 授權全文 / Licence text: <https://github.com/aria2/aria2/blob/master/COPYING>（每個 aria2 壓縮檔內也附有 `COPYING` / also included as `COPYING` in every aria2 archive we publish）
- Copyright (C) 2006 Tatsuhiro Tsujikawa and contributors. aria2 also carries an OpenSSL linking exception.

**修改說明 / Modifications**

PGet 使用的 aria2 有一個小補丁：把 `--max-connection-per-server` 的上限從 16 提高到 128，並把 `--min-split-size` 的下限從 1M 降到 1K。
PGet's aria2 is patched to raise the `--max-connection-per-server` cap from 16 to 128 and lower the `--min-split-size` minimum from 1M to 1K.

- **Windows**：使用 myfreeer 的強化版 / uses myfreeer's patched build — 原始碼與補丁 / source and patches: <https://github.com/myfreeer/aria2-build-msys2>
- **macOS／Linux**：由本 repo 自行建置 / built by this repository — 補丁 / patch: [`ci/aria2-max-connection.patch`](ci/aria2-max-connection.patch)，建置腳本 / build scripts: [`ci/`](ci/)、[`.github/workflows/aria2.yml`](.github/workflows/aria2.yml)，成品 / binaries: GitHub Releases `aria2-1.37.0-pget.N`

依 GPL-2.0，你可以從上述連結取得對應的完整原始碼。若連結失效，寄信到 <developer@pg72.tw> 索取，我們會提供（自該版本發佈起至少三年）。
Under GPL-2.0 the complete corresponding source is available at the links above. If a link stops working, email <developer@pg72.tw> and we will provide it (for at least three years from the release).

aria2 的 macOS／Linux 版本靜態連結了以下函式庫 / The macOS and Linux aria2 builds statically include:

| 元件 / Component | 授權 / Licence | 平台 / Platform |
|---|---|---|
| c-ares | MIT | macOS, Linux |
| Expat | MIT | macOS, Linux |
| OpenSSL 3 | Apache-2.0 | Linux |
| zlib | Zlib | Linux（macOS 用系統內建 / system library on macOS） |
| SQLite | Public domain | Linux（macOS 用系統內建 / system library on macOS） |
| libssh2 | BSD-3-Clause | Linux |
| musl libc | MIT | Linux |

---

## yt-dlp — The Unlicense

- 用途 / Used for: 影片網站下載 / downloading from video sites
- 上游 / Upstream: <https://github.com/yt-dlp/yt-dlp>
- 授權 / Licence: <https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE>（公有領域 / public domain dedication）
- 隨附的是 yt-dlp 官方發佈的執行檔，未修改。官方執行檔內含 Python 執行環境及其他元件，其授權列於 yt-dlp 發佈頁的 `THIRD_PARTY_LICENSES.txt`。
  We ship the unmodified official yt-dlp release binary. It bundles a Python runtime and other components whose licences are listed in `THIRD_PARTY_LICENSES.txt` on the yt-dlp release page.

---

## Electron — MIT

- 上游 / Upstream: <https://github.com/electron/electron>
- 授權 / Licence: <https://github.com/electron/electron/blob/main/LICENSE>
- Electron 內含 Chromium、Node.js、V8 等元件。完整授權清單隨安裝檔一起提供：`LICENSE.electron.txt` 與 `LICENSES.chromium.html`（位於程式安裝資料夾）。
  Electron includes Chromium, Node.js, V8 and more. Their full notices ship with every installer as `LICENSE.electron.txt` and `LICENSES.chromium.html` in the application folder.

---

## FFmpeg

目前**沒有**隨附 FFmpeg。yt-dlp 需要合併影音時，若系統已安裝 FFmpeg 會自動使用。若日後隨附，會在這裡補上授權（LGPL／GPL，依建置方式而定）與原始碼連結。
FFmpeg is currently **not** bundled. yt-dlp uses a system-installed FFmpeg if present. If we ever bundle it, its licence (LGPL/GPL depending on the build) and source link will be added here.

---

## npm 相依套件 / npm dependencies

建置工具（electron-builder 等）只在開發時使用，不會出現在安裝檔中。若桌面程式日後加入執行期相依套件，其授權會列在這裡。
Build tools such as electron-builder are development-only and not shipped. Any runtime npm dependency added to the app will be listed here.
