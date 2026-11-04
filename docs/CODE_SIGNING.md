# Windows 程式碼簽章（SignPath Foundation）

給維護者看的設定步驟。對外的政策頁在 <https://pget.pg72.tw/code-signing/>（原始內容在 `site/src/locales/*.mjs` 的 `signing`）。

## 怎麼運作

1. 推 `vX.Y.Z` tag → `release.yml` 照常用 electron-builder 打包。
2. Windows job 把 `PGet-Setup-X.Y.Z.exe` 與 `PGet-Portable-X.Y.Z.exe` 上傳成 workflow artifact，交給
   `signpath/github-action-submit-signing-request@v3` 送出簽章請求。
3. **Approver 到 SignPath 網站按核准**（每次發版都要，SignPath Foundation 的規定）。workflow 最多等 90 分鐘。
4. 簽好的 exe 取代原本的檔案，接著照常建立草稿 release。

沒有設定 `SIGNPATH_ORGANIZATION_ID` 時，這幾步會整個跳過，產出未簽章的檔案（跟以前一樣）。

只簽外層的安裝檔：SmartScreen 與 UAC 檢查的是使用者下載的那個檔案。安裝後的 `PGet.exe`
沒有「從網路下載」標記，不會跳警告。之後如果要連 `PGet.exe` 一起簽，要先 `--dir` 打包、
送簽 `PGet.exe`、再用 `--prepackaged` 產生安裝檔、再送簽一次（每次發版會變成要核准兩次）。

## 審核通過後要設定的東西

GitHub repo → Settings → Secrets and variables → Actions：

| 種類 | 名稱 | 值 |
|---|---|---|
| Secret | `SIGNPATH_API_TOKEN` | SignPath 裡有 submitter 權限的使用者（或 CI 使用者）的 API token |
| Variable | `SIGNPATH_ORGANIZATION_ID` | SignPath 的 organization ID |
| Variable | `SIGNPATH_PROJECT_SLUG` | 專案 slug（沒設定就用 `pget`） |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | 簽章原則 slug（沒設定就用 `release-signing`） |
| Variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | artifact configuration slug（沒設定就用 `installers`） |

SignPath 那邊：

- Trusted Build System 要加入 **GitHub.com**，並連結到 PGet 專案。
- 所有成員的 GitHub 與 SignPath 帳號都要開兩步驟驗證。
- 建議在 signing policy 開 `github-build-policies` 的 `runners.require_github_hosted`。

### Artifact configuration（slug：`installers`）

workflow 上傳的 artifact 是一個 zip，裡面有兩個 exe。`version` 參數由 workflow 傳入（tag 名稱，例如 `v0.1.3`）。

```xml
<?xml version="1.0" encoding="utf-8"?>
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <pe-file-set product-name="PGet">
      <include path="PGet-Setup-*.exe" />
      <include path="PGet-Portable-*.exe" />
      <for-each>
        <authenticode-sign />
      </for-each>
    </pe-file-set>
  </zip-file>
</artifact-configuration>
```

SignPath Foundation 要求限制 product name 與 product version。第一次設定時，建議把某次 release 的兩個 exe
壓成 zip，上傳到 SignPath 的「artifact sample」讓它自動產生設定，再對照上面這份補上
`product-version` 等限制（electron-builder 寫進 NSIS 安裝檔的版本字串，以 SignPath 讀到的為準）。

## SignPath Foundation 的規定重點

- 只簽本專案原始碼建置的檔案；aria2、yt-dlp、Electron 的 DLL 不能用這張憑證簽（可以不簽、包在安裝檔裡）。
- 建置必須在 GitHub 提供的 runner 上執行，不能用 self-hosted runner。
- 首頁與下載／發布頁都要出現「Code signing policy」字樣，並連到政策頁（官網頁尾、下載區、README、release 說明都有）。
- 修改 build script 或 CI 設定時要特別小心 review，它們也算原始碼。
- 完整條款：<https://signpath.org/terms>
