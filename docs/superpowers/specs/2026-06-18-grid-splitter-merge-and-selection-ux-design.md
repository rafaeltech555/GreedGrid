# GreedGrid Post-v1 — Splitter / Merge 修復 + Cell 選取 UX 設計

_Date: 2026-06-18_

---

## Overview / Goals

v1 完成後實機測試發現兩個 grid 互動問題,本設計一次處理:

1. **Bug — merge 後 splitter 線穿過合併格。** 把兩個相鄰 cell 合併成一個 spanning cell 後,原本兩格之間的那條 splitter 分隔線仍然顯示(且仍可拖動),穿過合併後的 cell。視覺上像合併沒完成。
2. **UX — cell 選取機制不直覺。** 目前選取靠 hover 出現 ◉ 把手再點按。發現不直覺、不方便。改成兩條更自然的路徑:**Select 模式 toggle 按鈕** + **Ctrl/Cmd + 左鍵直接選**,並移除 ◉ 把手。

**Non-goals（YAGNI — 明確排除）：** 拖曳框選(drag-rubber-band 多選)、選取後鍵盤方向鍵移動、touch 手勢選取、splitter 在部分合併邊界上的個別拖動行為調整(維持「拖任一段 resize 整條 track」的既有語意)。

---

## 背景 — 既有實作（已查證）

- **Grid 渲染**:`src/grid/GridHost.tsx` 用 CSS Grid(`fr` tracks + span 放置)畫 cell,並在每條內部 track 邊界**overlay 一個 full-length `Splitter`**。邊界 px 中心由 `boundaryCenters()` 算。
- **Splitter**:`src/grid/Splitter.tsx` 是絕對定位的可拖 gutter,`isCol` 時 style 寫死 `top:0, height:"100%"`(row 則 `left:0, width:"100%"`),內含一條 `bg-white/10` 可見細線(hover 變 emerald)。
- **Merge**:`src/grid/merge.ts` 的 `mergeCells` 把 rectangular selection 併成一個 spanning cell(`colSpan`/`rowSpan` > 1),**不移除 track**(`cols`/`rows` 陣列長度不變)。`splitCell` 反向拆回。
- **選取狀態**:`src/store/layoutStore.ts` 有 `selectedIds`、`toggleSelect`、`clearSelection`、`mergeSelected`、`splitSelected`(後兩者成功後清空 selection)。
- **選取 UI**:`src/grid/GridCell.tsx` 內一顆 `aria-label="Select cell"` 的 ◉ button(hover 顯示),點按 `toggleSelect(cell.id)`;選取時 cell 加 `ring-2 ring-inset ring-emerald-400`。
- **Toolbar**:`src/components/Toolbar.tsx` 有 Merge / Split 按鈕(disabled 由 `selectionMergeable` / `selectionSplittable` 決定)與「N selected · clear」。
- **Terminal refit**:`src/panels/terminal/TerminalView.tsx` 已有 `ResizeObserver` → `FitAddon.fit()`,合併放大後 terminal 會自動 refit(**確認非 bug 來源**)。

---

## §1 Bug 修復 — Splitter 依合併切段

### 成因

merge 不移除 track,所以該邊界的 `Splitter` 仍被 `GridHost` 畫出來,且 `height:"100%"` 整條畫過合併後的 spanning cell,顯示那條 `bg-white/10` 細線(已用放大截圖確認那條線就是 splitter overlay,非 CSS gap、非 xterm 未 refit)。

### 設計

讓每條邊界的 splitter **依「跨越該邊界的 cell」切成多段**,只在「沒有任何 cell 跨越該邊界」的 cross-axis 區段畫線 / 可拖。被 spanning cell 跨越的區段不畫、也不可拖。

**座標約定**(沿用既有 1-based track 座標,見 `merge.ts`):

- Column 邊界 index `k`（`k` 從 `1` 到 `cols.length - 1`）位於 column `k` 與 `k+1` 之間。
- 一個 cell **跨越** column 邊界 `k`,當 `cell.col <= k` 且 `cell.col + cell.colSpan - 1 >= k + 1`。
- 跨越時,被遮蔽的 cross-axis(row)範圍是該 cell 的 `[cell.row, cell.row + cell.rowSpan - 1]`。
- Row 邊界對稱(交換 col/row）。

### 新增純函式（`src/grid/merge.ts`）

```ts
/** 一段未被跨越的 cross-axis track 連續區間(1-based, inclusive)。 */
export interface SplitterSegment {
  /** cross-axis 起始 track（col 邊界→row;row 邊界→col）。 */
  start: number;
  /** cross-axis 結束 track（inclusive）。 */
  end: number;
}

/**
 * 給定 cells、邊界軸與邊界 index,回傳該邊界上「沒有 cell 跨越」的
 * cross-axis track 連續區間清單。完全沒有合併時回傳整條一段;
 * 被 spanning cell 跨越處切掉,中間可留洞（部分 row/col 合併）。
 */
export function boundarySegments(
  cells: Cell[],
  axis: "col" | "row",
  boundaryIndex: number,
  crossTrackCount: number, // axis="col" 時為 rows.length;反之 cols.length
): SplitterSegment[]
```

**演算法**:對 cross-axis 上每個 track（`1..crossTrackCount`）標記是否被「跨越該邊界的 cell」遮蔽,再把連續未遮蔽的 track 收斂成 `[start, end]` 區間清單。純函式、無 side effect。

**單元測試**(`src/grid/merge.test.ts`)：
- 無 merge → 整條一段 `[{start:1, end:N}]`。
- 一個 cell 跨越整條邊界（如 2 column 全合併）→ 回傳空陣列。
- 部分合併（只有上半合併跨越邊界）→ 回傳下半那一段。
- 中間留洞（上、下合併、中間單格）→ 回傳中間那段。

### Splitter 元件改動（`src/grid/Splitter.tsx`）

`Splitter` 改吃 cross-axis 子範圍的 px:

```ts
interface SplitterProps {
  orientation: "col" | "row";
  pos: number;          // 沿主軸的 gutter 中心 px（不變）
  hit: number;          // 主軸 hit 厚度（不變）
  crossStart: number;   // 新增:cross-axis 起始 px
  crossLength: number;  // 新增:cross-axis 長度 px
  onDragStart / onResize / onDragEnd  // 不變
}
```

style 由寫死的 `top:0/height:"100%"`（col）改為 `top: crossStart, height: crossLength`;row 對稱用 `left/width`。其餘拖動邏輯不變。

### GridHost 改動（`src/grid/GridHost.tsx`）

每條邊界從「render 1 個 Splitter」改為「對 `boundarySegments(...)` 的每段 render 1 個 Splitter」:
- 邊界主軸 px 位置沿用既有 `boundaryCenters()`。
- 每段的 `crossStart` / `crossLength`:把 segment 的 track range 用 cross-axis 的 track 尺寸 + gap 換算成 px(複用既有「fr → px」邏輯,抽一個 helper 算「track 1..n 的累積 px 起點與長度」)。
- key 需含邊界 index 與段序(如 `col-${k}-${segIdx}`）。

**行為**:合併處不再畫線;部分合併時其餘區段仍可拖;resize 語意不變(fr track 是一維,拖任一段都 resize 整條 track)。

---

## §2 UX — Cell 選取機制

兩條選取路徑並存,移除 ◉ 把手。

### §2.1 Select 模式 toggle 按鈕

**Store（`src/store/layoutStore.ts`）新增**:
```ts
selectMode: boolean;            // 預設 false
setSelectMode: (on: boolean) => void;
toggleSelectMode: () => void;   // 切換;關閉時一併 clearSelection
```
- `toggleSelectMode` / `setSelectMode(false)` 關閉時必須清空 `selectedIds`。
- `mergeSelected` / `splitSelected` 成功後,除了既有的清空 selection,**另把 `selectMode` 設為 false**(操作完成自動退出,回到正常 panel 操作)。

**Toolbar（`src/components/Toolbar.tsx`）**:在 Merge 前加一顆 **Select** toggle 按鈕,啟用中時高亮(emerald)。

**GridCell（`src/grid/GridCell.tsx`）**:`selectMode` 為 true 時,在 cell 內疊一層透明 overlay:
```
absolute inset-0 z-20 cursor-pointer
```
- overlay `onClick` → `e.stopPropagation()` + `toggleSelect(cell.id)`。
- overlay 蓋在 panel View 之上,**攔截所有點擊**,因此放了 Web(iframe)/ Terminal 的格也能選(解決 iframe 吃事件問題)。
- select 模式下 cell 顯示可選提示(未選:淡 `ring-1 ring-white/20`;已選:既有 emerald ring)。

**退出**:再按 Select 按鈕、merge/split 完成、或按 **Esc**(在 grid 容器或 document 監聽,select 模式時 Esc → `setSelectMode(false)`)。

### §2.2 Ctrl/Cmd + 左鍵直接選

非 select 模式時,在 cell wrapper 的 `onClick` 判斷修飾鍵:
```ts
if (e.ctrlKey || e.metaKey) {
  e.stopPropagation();
  e.preventDefault();
  toggleSelect(cell.id);
  return;
}
```
- 適用空格與 Terminal / System / File 格(事件能冒泡到 wrapper)。
- **限制(documented)**:放了 Web(iframe)的格,點擊不會傳到父層 React,Ctrl+click 收不到 → 該類格請用 Select 模式選取。此限制寫進 README/註解。

### §2.3 移除 ◉ 把手

刪除 `GridCell.tsx` 內 `aria-label="Select cell"` 的 button。selection 的 emerald ring 視覺保留。相關測試同步更新。

---

## §3 測試與驗證

**單元 / 元件測試(Vitest）**:
- `merge.test.ts`：`boundarySegments` 四種情境(見 §1)。
- `layoutStore.test.ts`：`toggleSelectMode` / `setSelectMode(false)` 清空 selection;`mergeSelected` / `splitSelected` 成功後 `selectMode` 變 false。
- `GridCell.test.tsx`：Ctrl/Cmd+click 觸發 `toggleSelect`;select 模式 overlay 點擊觸發 `toggleSelect`;◉ 把手已移除。
- `Toolbar.test.tsx`：Select 按鈕 toggle `selectMode` 並反映高亮。

**原生 GUI 驗證**(沿用 `verify-tauri-gui` 配方,X11/XTest/全螢幕截圖 crop)：
1. 重現原 bug:放 Terminal、選兩格、Merge → 確認**合併處 splitter 線消失**(放大截圖比對)。
2. Split 回去 → 確認 splitter 線回來、可拖。
3. **Select 模式**:按 Select → 點兩個相鄰格(含放 iframe 的格)→ Merge 成功 → 確認自動退出 select 模式。
4. **Ctrl+click**:非 select 模式,Ctrl+左鍵點兩格 → Merge 成功。
5. 確認 ◉ 把手已不存在。

---

## §4 受影響檔案

| 檔案 | 變更 |
|---|---|
| `src/grid/merge.ts` | 新增 `boundarySegments` + `SplitterSegment` |
| `src/grid/merge.test.ts` | 新增 `boundarySegments` 測試 |
| `src/grid/Splitter.tsx` | 加 `crossStart`/`crossLength`,改 style |
| `src/grid/GridHost.tsx` | 每邊界依 segments render 多段 Splitter;抽 track→px helper |
| `src/store/layoutStore.ts` | 加 `selectMode` / `setSelectMode` / `toggleSelectMode`;merge/split 後退出 select 模式 |
| `src/store/layoutStore.test.ts` | selectMode 行為測試 |
| `src/grid/GridCell.tsx` | 移除 ◉ 把手;加 select-mode overlay + Ctrl/Cmd+click |
| `src/grid/GridCell.test.tsx` | 更新選取相關測試 |
| `src/components/Toolbar.tsx` | 加 Select toggle 按鈕 |
| `src/components/Toolbar.test.tsx` | Select 按鈕測試 |
| `README.md` | 更新 post-v1「Cell-select handle」段落為新選取機制 + iframe Ctrl+click 限制註記 |
