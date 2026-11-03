# 擴充功能 ↔ 桌面程式 通訊協定（v1）

桌面程式在 `127.0.0.1` 開 HTTP 伺服器（**只綁 127.0.0.1**）。
連接埠預設 `17890`，被占用時依序試 `17891`～`17899`。擴充功能依序探測。

所有回應都是 JSON，`Content-Type: application/json`。
CORS：有帶 `Origin` 的請求只允許 `chrome-extension://*`（其他 Origin 一律 403），並回應 `Access-Control-Allow-Origin` 為該 Origin。
沒有 `Origin` 的請求也放行：擴充功能對有主機權限的網址發 GET 時，瀏覽器不會帶 `Origin`。網頁的跨來源請求一定會帶 `Origin`，所以仍然會被擋；`Host` 必須是 `127.0.0.1` 或 `localhost` 加上本埠（防 DNS rebinding）。

## GET /ping

不需要 token。

```json
{ "app": "PGet", "version": "0.1.0", "protocol": 1 }
```

## POST /pair

不需要 token。請求：`{ "client": "Chrome 131 / PGet Extension 0.1.0" }`

桌面程式跳出確認視窗（「有擴充功能要求連線，允許嗎？」）。
- 使用者允許：`200 { "token": "<32 bytes hex>" }`，token 存在桌面程式設定裡（可以有多個，設定頁可撤銷）
- 使用者拒絕或 60 秒逾時：`403 { "error": "denied" }`

## POST /add

標頭 `X-PGet-Token: <token>`。token 錯誤 → `401 { "error": "unauthorized" }`（擴充功能應清掉 token 並重新配對）。

```json
{
  "url": "https://example.com/file.zip",
  "filename": "file.zip",          // 可選，瀏覽器建議的檔名
  "referrer": "https://example.com/page", // 可選
  "cookies": "a=1; b=2",           // 可選，只含該 url 的 cookie
  "userAgent": "Mozilla/5.0 ...",  // 可選
  "size": 123456,                  // 可選，bytes，未知為 0
  "mime": "application/zip",       // 可選
  "kind": "auto"                   // auto | http | video | torrent | magnet
}
```

回應 `200 { "id": "<task id>" }`。桌面程式收到後把視窗帶到前景或跳通知（依設定）。

`kind: auto` 時由桌面程式判斷：`magnet:` → magnet；`.torrent` → torrent；已知影片網站網址 → video（交給 yt-dlp）；其他 → http（交給 aria2）。

## 擴充功能攔截規則（預設，可在擴充功能選項調整）

- 只攔截 `http(s)` 與 `magnet:`；`blob:`、`data:`、`file:` 一律放行給瀏覽器
- 檔案大小已知且小於 1 MB → 放行（可調）
- 桌面程式 /ping 不通 → 放行給瀏覽器，不要讓使用者下載失敗
- 按住 Alt 點擊的下載 → 放行（無法偵測時以選項中的「暫停攔截」開關代替）
- 右鍵選單：「用 PGet 下載連結」「用 PGet 下載影片（此頁）」
