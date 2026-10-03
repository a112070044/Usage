# Claude 用量即時顯示

隨時看到你的 Claude 額度還剩多少（5 小時 / 7 天限制的剩餘百分比與重置倒數）。提供兩種版本：

| 你在哪裡用 Claude | 用哪個 |
|---|---|
| **Claude 電腦版 App**（Mac／Windows），或任何地方 | [桌面小視窗](#桌面小視窗mac--windows) — 永遠浮在螢幕角落 |
| **iPhone** | [iPhone 小工具](#iphone-小工具scriptable) — 主畫面／鎖定畫面小工具 |
| 瀏覽器開 claude.ai | [瀏覽器擴充功能](#瀏覽器擴充功能) — 直接顯示在聊天頁面上 |

---

## 桌面小視窗（Mac / Windows）

一個永遠置頂的小視窗，不管你用 Claude App 還是瀏覽器聊天都看得到。Mac 選單列／Windows 系統匣也會顯示 5 小時額度剩餘 %。

### 下載

1. 到 GitHub repo 的 **Actions** 分頁 → 點最新一次成功的「打包桌面小視窗」
2. 在頁面最下方 **Artifacts** 下載：
   - Mac：`claude-usage-widget-macOS`（裡面是 `.dmg`）
   - Windows：`claude-usage-widget-Windows`（安裝版 `Setup.exe` 或免安裝的 `portable.exe`）

### 第一次開啟

- **Mac**：打開 `.dmg`，把 App 拖進「應用程式」。因為沒有 Apple 簽章，第一次請在 App 上 **按右鍵 → 打開 → 打開**。若顯示「已損毀」，在終端機執行：
  `xattr -cr "/Applications/Claude Usage Widget.app"`
- **Windows**：若出現「Windows 已保護您的電腦」，點 **其他資訊 → 仍要執行**。

開啟後會自動跳出 Claude 登入視窗，登入一次即可（之後會記住）。
> 💡 如果用 Google 登入被擋（「此瀏覽器或應用程式可能不安全」），請改用 **Email 登入**，輸入信箱後到信箱收驗證碼／連結。

### 操作

- 拖曳標題列移動，位置會記住；`–`／`+` 收合成一顆小膠囊；`×` 隱藏
- 點 Mac 選單列／Windows 系統匣圖示可以顯示／隱藏小視窗；右鍵選單有：立即刷新、登出、**開機時自動啟動**、離開
- 每 30 秒自動更新一次

### 自己從原始碼執行（開發用）

```bash
cd desktop
npm install
npm start
```

---

## iPhone 小工具（Scriptable）

在主畫面或鎖定畫面放一個小工具，看 Claude 額度還剩多少。

### 安裝

1. 從 App Store 安裝免費的 **Scriptable**
2. 在 iPhone 上用 Safari 打開 repo 裡的 [`iphone/claude-usage.js`](iphone/claude-usage.js)，點 **Raw**，全選並複製全部內容
3. 打開 Scriptable → 右上角 **＋** → 貼上 → 點上方標題改名為「Claude 用量」→ 完成
4. 在 Scriptable 裡點一下這個腳本執行：
   - 會跳出 claude.ai 登入頁面，**請用 Email 登入**（Google 登入在 App 內嵌瀏覽器通常會被擋），到信箱收驗證碼
   - 看到聊天畫面後，按左上角 **關閉（Close）**
   - 接著會顯示目前用量，並可以預覽小工具
5. 回主畫面長按空白處 → 左上角 **＋** → 找 **Scriptable** → 選尺寸加入 → 長按小工具 → **編輯小工具** → Script 選「Claude 用量」
   - 鎖定畫面也一樣：長按鎖定畫面 → 自訂 → 加入小工具 → Scriptable

### 要知道的事

- **想看最新數字就點一下小工具。** iOS 不讓小工具在背景使用 Scriptable 裡的登入狀態，所以小工具顯示的是你**上次點開時**的數字，底下會寫是幾點的數字。點一下會打開 Scriptable 抓最新用量並顯示結果，回主畫面後小工具就會換成新數字。
- 重置倒數會自己跑；重置時間過了會顯示「已重置」。超過 1 小時沒更新，時間會變成橘色。
- 登入狀態只存在 Scriptable 自己的瀏覽器裡。Scriptable 要求登入時，用 Email 重新登入即可。

---

## 瀏覽器擴充功能

一個瀏覽器擴充功能（Chrome / Edge / Brave / Arc 等 Chromium 瀏覽器），在你使用 **claude.ai 對話框**時，於頁面右上角顯示一個小面板，即時看到額度還剩多少。

### 會顯示什麼

- **5 小時**額度：剩餘百分比、進度條、距離重置還有多久
- **7 天**額度（全部模型），以及帳號有的話：**7 天 Opus / Sonnet** 等分項額度
- 工具列圖示上的徽章數字 = 5 小時額度剩餘 %
- 顏色：綠（> 30%）、橘（≤ 30%）、紅（≤ 10%）

### 什麼時候會更新

- 開啟頁面時
- 每 60 秒（分頁在前景時）
- 你按 Enter 或點「傳送」後 4 秒與 20 秒各再刷新一次，讓數字跟著對話變化
- 切回分頁時，或手動按面板上的 ↻

### 安裝

1. 下載這個 repo（`Code → Download ZIP` 後解壓縮，或 `git clone`）
2. 打開 `chrome://extensions`（Edge 是 `edge://extensions`）
3. 右上角開啟「**開發人員模式**」
4. 點「**載入未封裝項目**」，選擇 repo 裡的 `extension` 資料夾
5. 打開或重新整理 <https://claude.ai>，右上角就會出現面板

建議把擴充功能釘選在工具列，就能隨時看到徽章數字。

### 操作

- 拖曳標題列可以移動面板，位置會被記住
- `–` / `+` 收合／展開；收合後只留下一顆百分比小膠囊
- 滑鼠停在重置倒數上會顯示確切的重置時間

## 原理與注意事項（兩個版本共通）

- 擴充功能用瀏覽器現有的登入狀態；桌面小視窗與 iPhone 小工具則在自己獨立的內建瀏覽器裡登入 claude.ai（登入資訊只存在你自己的裝置上）。兩者都是呼叫 claude.ai 網頁「設定 → 用量」頁本身使用的 `/api/organizations/{組織 ID}/usage`。
- 不會把任何資料送到其他地方，也不需要你輸入 API 金鑰或密碼。
- 這是 claude.ai 的**內部 API，非官方公開**，Anthropic 改版時可能失效；面板底部會顯示錯誤訊息（例如 `HTTP 404`），屆時需要更新程式。
- 數值代表的是訂閱方案（Pro / Max）的使用限制百分比，與 API 的 token 計費無關。

## 檔案結構

```
desktop/                 # 桌面小視窗（Electron）
├── main.js              # 登入、抓用量、置頂視窗、系統匣
├── preload.js
├── renderer/            # 小視窗畫面
└── assets/              # 系統匣圖示
extension/               # 瀏覽器擴充功能（Manifest V3）
├── manifest.json
├── content.js           # 取得用量、繪製面板、刷新邏輯
├── content.css
└── background.js        # 更新工具列徽章
iphone/claude-usage.js   # iPhone 小工具（Scriptable 腳本）
.github/workflows/desktop.yml  # 自動打包 Mac / Windows 安裝檔
```
