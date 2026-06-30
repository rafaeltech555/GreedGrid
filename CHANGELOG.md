# Changelog

本檔案依 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/) 格式撰寫，版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

---

## [1.1.0] - 2026-06-30

### Added

#### Panel maximize（分隔視窗放大）

- 每個 panel 的控制列新增 `⛶` 放大鈕；按下後，該格放大佔滿整個 grid，其餘 panel 隱藏但在背景保持運行（Terminal PTY、System Monitor 取樣、Web 頁面等皆不中斷）。
- 按 `Esc` 或再次點擊控制列按鈕可還原為原始 grid 佈局。
- Web panel 的原生 webview（wry + gtk::Overlay）在放大時同步放大、在縮小時同步隱藏，確保 native overlay 位置與主視窗 DOM 保持一致。
- 切換 layout preset 或載入 workspace 時自動退出放大狀態並還原，避免 grid 重建後 panel 卡在全螢幕。

#### Terminal IDLE reminder（終端機閒置提示）

- Terminal panel 的前景指令執行完畢、而使用者尚未回看該格時，以 amber 慢速動畫提醒（自訂 keyframes：邊框光暈 `glowpulse`、laptop+zzz 圖示 `zfloat`/`breathe`，並尊重 `prefers-reduced-motion`）：
  - **per-panel 邊框光暈**：閒置中的 terminal cell 邊框顯示 amber 漸層光圈。
  - **「此面板閒置」徽章**：panel 左下浮出可點擊徽章，點擊即清除該格閒置。
  - **工具列狀態 chip**：Toolbar 右側顯示「閒置 / 活動中」狀態 chip；任一 terminal 閒置時轉 amber，點擊即清除**全部**閒置提示。
  - **System tray**（首次引入）：tray icon 在有 terminal 閒置時變色；tray 選單提供「顯示視窗」與「結束」兩項（Cinnamon / libappindicator 環境必須掛選單才顯示 tray icon，因此同時解決了 tray 不可見問題）。
- 前景指令偵測：透過 pty 的 `process_group_leader()` 判斷是否有前景 process 在跑；shell 等待輸入時視為閒置。
- **清除條件（回看即清除）**：在 terminal panel 中鍵入任何字元、滑鼠點擊、聚焦主視窗、點擊工具列 chip、或點選 tray 選單「顯示視窗」，均視為「使用者已回看」並清除閒置狀態。

### Fixed

- **Cinnamon / libappindicator 下 tray 不顯示**：libappindicator 要求 tray icon 必須附帶 `Menu` 才能出現於系統托盤；本版在建立 tray 時一律掛上「顯示視窗 / 結束」選單，解決 Cinnamon 桌面環境下 tray icon 無法顯示的問題。

---

## [1.0.0] - 2026-06-28

初始正式版本，涵蓋完整 M0–M6 里程碑與所有 post-v1 補強功能：

- 可調整大小、可合併/分割的 grid 佈局引擎（M0–M1）
- 可插拔 panel 架構，含 Terminal、File Browser、Web（native webview）、System Monitor（M2–M5）
- 具名 workspace 持久化（M6）
- Post-v1：cell 選取模式、splitter 修正、panel 拖移搬家、native webview overlay、merge 保留 panel 等

[1.1.0]: https://github.com/rafaeltech555/GreedGrid/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/rafaeltech555/GreedGrid/releases/tag/v1.0.0
