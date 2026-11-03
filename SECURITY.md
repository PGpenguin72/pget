# 安全性政策 / Security Policy

## 回報漏洞

**請不要用公開的 GitHub Issue 回報安全性問題。** 請用以下任一方式私下回報：

1. **GitHub Security Advisories（建議）**：<https://github.com/PGpenguin72/pget/security/advisories/new>
2. **Email**：<developer@pg72.tw>

請盡量附上：

- 受影響的元件（桌面程式、瀏覽器擴充功能、官網）與版本
- 重現步驟或概念驗證（PoC）
- 可能的影響

我們會在 7 天內回覆，確認問題後盡快修正，並在修正版發佈後公開說明（若你願意，會在說明中致謝）。

## 特別在意的範圍

PGet 的核心承諾是「不夾帶任何東西」，以下問題我們會特別重視：

- 本機 HTTP 端點（`127.0.0.1`）可被網頁或其他來源繞過 token 驗證、或被遠端存取
- 擴充功能把 cookie 或網址送到桌面程式以外的地方
- 任何未經同意的對外連線、資料收集
- 下載的引擎（aria2、yt-dlp）雜湊驗證可被繞過

## 支援的版本

只有最新的正式版會收到安全性修正。

---

## Reporting a vulnerability

**Please do not report security issues through public GitHub issues.** Report them privately via:

1. **GitHub Security Advisories (preferred)**: <https://github.com/PGpenguin72/pget/security/advisories/new>
2. **Email**: <developer@pg72.tw>

Include the affected component and version, reproduction steps or a PoC, and the potential impact. We aim to reply within 7 days, fix confirmed issues promptly, and publish an advisory once a fixed release is out (with credit, if you wish).

Of particular interest: bypassing token checks or remote access to the local `127.0.0.1` endpoint, the extension leaking cookies or URLs anywhere other than the local app, any unconsented network traffic or data collection, and bypassing engine hash verification.

Only the latest release receives security fixes.
