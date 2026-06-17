# Post-v1 Splitter/Merge Fix + Cell Selection UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉 merge 後 splitter 分隔線穿過合併格的 bug,並把 cell 選取改成 Select 模式按鈕 + Ctrl/Cmd+click(移除 ◉ 把手)。

**Architecture:** Part A — 新增純函式 `boundarySegments` 把每條 track 邊界的 splitter 依「跨越它的 cell」切段,`Splitter` 改吃 cross-axis 子範圍,`GridHost` 每邊界 render 多段。Part B — `layoutStore` 加 `selectMode` 狀態,Toolbar 加 toggle 按鈕,GridCell 用透明 overlay(select 模式)+ Ctrl/Cmd+click(capture phase)選取。

**Tech Stack:** React 19 + TypeScript + Zustand + Tailwind v4;測試 Vitest + Testing Library;最後用 `verify-tauri-gui` 配方做原生 GUI 驗證。

設計依據:`docs/superpowers/specs/2026-06-18-grid-splitter-merge-and-selection-ux-design.md`

執行於 branch `post-v1-splitter-merge-selection`(spec 已 commit 於 `44376be`)。

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/grid/merge.ts` | 既有 merge 幾何 + 新增 `boundarySegments` / `SplitterSegment`(純函式) |
| `src/grid/trackPx.ts` | **新檔**:`trackSpanPx` 把 1-based track range 換算成 cross-axis px offset/length(純函式) |
| `src/grid/Splitter.tsx` | 加 `crossStart`/`crossLength` props,改 inline style |
| `src/grid/GridHost.tsx` | 每邊界依 `boundarySegments` render 多段 Splitter,用 `trackSpanPx` 算 px |
| `src/store/layoutStore.ts` | 加 `selectMode` + `setSelectMode`/`toggleSelectMode`;merge/split 成功後退出 select 模式 |
| `src/grid/GridCell.tsx` | 移除 ◉ 把手;加 select-mode overlay + Ctrl/Cmd+click(capture) |
| `src/components/Toolbar.tsx` | 加 Select toggle 按鈕 + Esc 退出 |
| `README.md` | 更新 post-v1 選取機制段落 + iframe Ctrl+click 限制(Task 7,委派 Sonnet) |

測試檔:`merge.test.ts`、`trackPx.test.ts`(新)、`Splitter.test.tsx`(新)、`layoutStore.test.ts`、`GridCell.test.tsx`、`Toolbar.test.tsx`。

**驗證指令**:單一檔 `pnpm test -- <path>`;全部 `pnpm test`;型別 `pnpm typecheck`。

---

## Task 1: `boundarySegments` 純函式（splitter 切段邏輯）

**Files:**
- Modify: `src/grid/merge.ts`(檔尾新增)
- Test: `src/grid/merge.test.ts`(新增一個 describe)

- [ ] **Step 1: 寫失敗測試**

在 `src/grid/merge.test.ts` 既有 import 區把 `boundarySegments` 加進從 `"./merge"` 的 import,並在檔尾新增:

```ts
describe("boundarySegments", () => {
  // 建一個只帶幾何欄位的 cell(boundarySegments 只看 col/row/span)。
  const cell = (col: number, row: number, colSpan: number, rowSpan: number) => ({
    id: cellId(col, row),
    col,
    row,
    colSpan,
    rowSpan,
    panel: null,
  });

  it("no merge: whole boundary is one segment", () => {
    // 3 rows;col 邊界 1 沒有任何 cell 跨越 → 整條一段
    const cells = makePreset(9).cells;
    expect(boundarySegments(cells, "col", 1, 3)).toEqual([{ start: 1, end: 3 }]);
  });

  it("a cell spanning the full boundary leaves no segment", () => {
    // 一個 cell 跨 col1-2、rows1-3 → col 邊界 1 全被遮 → []
    const cells = [cell(1, 1, 2, 3)];
    expect(boundarySegments(cells, "col", 1, 3)).toEqual([]);
  });

  it("a partial (top-row) span clips that row only", () => {
    // cell 跨 col1-2 但只在 row1 → 邊界 1 遮 row1 → 剩 [2,3]
    const cells = [cell(1, 1, 2, 1)];
    expect(boundarySegments(cells, "col", 1, 3)).toEqual([{ start: 2, end: 3 }]);
  });

  it("spans at top and bottom leave a hole in the middle", () => {
    const cells = [cell(1, 1, 2, 1), cell(1, 3, 2, 1)];
    expect(boundarySegments(cells, "col", 1, 3)).toEqual([{ start: 2, end: 2 }]);
  });

  it("row axis: a cell spanning row1-2 across all cols blocks row boundary 1", () => {
    const cells = [cell(1, 1, 3, 2)];
    expect(boundarySegments(cells, "row", 1, 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- src/grid/merge.test.ts`
Expected: FAIL — `boundarySegments is not a function`(import 解析不到)。

- [ ] **Step 3: 實作**

在 `src/grid/merge.ts` 檔尾新增(`Cell` 已在檔首 import):

```ts
/** 一段未被 spanning cell 跨越的 cross-axis track 連續區間(1-based, inclusive)。 */
export interface SplitterSegment {
  start: number;
  end: number;
}

/**
 * 給定 cells、邊界軸與邊界 index,回傳該邊界上「沒有 cell 跨越」的 cross-axis
 * track 連續區間清單。
 *
 * 座標(沿用本檔 1-based track 約定):
 * - axis="col" 時,邊界 `boundaryIndex` 位於 column k 與 k+1 之間;cell 跨越它
 *   當 `cell.col <= k && cell.col + cell.colSpan - 1 >= k+1`,遮蔽其 row 範圍。
 * - axis="row" 對稱(交換 col/row)。
 *
 * 無 merge → 整條一段;被跨越處切掉,中間可留洞。
 */
export function boundarySegments(
  cells: Cell[],
  axis: "col" | "row",
  boundaryIndex: number,
  crossTrackCount: number,
): SplitterSegment[] {
  // occluded[t] = cross-axis track t(1-based)是否被跨越該邊界的 cell 遮蔽。
  const occluded = new Array<boolean>(crossTrackCount + 1).fill(false);
  for (const c of cells) {
    const crosses =
      axis === "col"
        ? c.col <= boundaryIndex && c.col + c.colSpan - 1 >= boundaryIndex + 1
        : c.row <= boundaryIndex && c.row + c.rowSpan - 1 >= boundaryIndex + 1;
    if (!crosses) continue;
    const lo = axis === "col" ? c.row : c.col;
    const hi = axis === "col" ? c.row + c.rowSpan - 1 : c.col + c.colSpan - 1;
    for (let t = lo; t <= hi; t++) {
      if (t >= 1 && t <= crossTrackCount) occluded[t] = true;
    }
  }

  const segments: SplitterSegment[] = [];
  let runStart: number | null = null;
  for (let t = 1; t <= crossTrackCount; t++) {
    if (!occluded[t]) {
      if (runStart === null) runStart = t;
    } else if (runStart !== null) {
      segments.push({ start: runStart, end: t - 1 });
      runStart = null;
    }
  }
  if (runStart !== null) segments.push({ start: runStart, end: crossTrackCount });
  return segments;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- src/grid/merge.test.ts`
Expected: PASS(含既有 merge 測試)。

- [ ] **Step 5: Commit**

```bash
git add src/grid/merge.ts src/grid/merge.test.ts
git commit -m "feat(grid): boundarySegments — split splitter runs around merged cells"
```

---

## Task 2: `trackSpanPx` 純函式（track range → cross-axis px）

**Files:**
- Create: `src/grid/trackPx.ts`
- Test: `src/grid/trackPx.test.ts`

- [ ] **Step 1: 寫失敗測試**

建 `src/grid/trackPx.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { trackSpanPx } from "./trackPx";

// areaPx 已扣掉 gap(沿用 GridHost 的 areaW/areaH 慣例);兩條等寬 track。
describe("trackSpanPx", () => {
  it("single first track: offset 0, width = its share", () => {
    expect(trackSpanPx([1, 1], 100, 10, 1, 1)).toEqual({ offset: 0, length: 50 });
  });

  it("spanning both tracks includes the internal gap", () => {
    // 50 + 50 + 1 internal gap(10) = 110
    expect(trackSpanPx([1, 1], 100, 10, 1, 2)).toEqual({ offset: 0, length: 110 });
  });

  it("second track: offset past first track + one gap", () => {
    expect(trackSpanPx([1, 1], 100, 10, 2, 2)).toEqual({ offset: 60, length: 50 });
  });

  it("uneven fr ratios split area proportionally", () => {
    // sum=4;track1=1/4*100=25,track2=3/4*100=75
    expect(trackSpanPx([1, 3], 100, 10, 2, 2)).toEqual({ offset: 35, length: 75 });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- src/grid/trackPx.test.ts`
Expected: FAIL — 找不到 `./trackPx`。

- [ ] **Step 3: 實作**

建 `src/grid/trackPx.ts`:

```ts
/**
 * 把 1-based、inclusive 的 track range 換算成沿該軸的 px 區間。
 *
 * `tracks` 是 `fr` 比例陣列;`areaPx` 是「已扣掉所有 gap」的可用像素
 * (對應 GridHost 的 areaW / areaH);`gap` 是 track 間的 px gutter。
 * 回傳 `start` track 起始邊到 `end` track 結束邊的 offset 與 length
 * (含其間的內部 gap)。
 */
export function trackSpanPx(
  tracks: number[],
  areaPx: number,
  gap: number,
  start: number,
  end: number,
): { offset: number; length: number } {
  const sum = tracks.reduce((a, b) => a + b, 0) || 1;
  const px = (i: number) => (tracks[i] / sum) * areaPx; // 0-based track 寬度

  let offset = 0;
  for (let j = 0; j < start - 1; j++) offset += px(j);
  offset += (start - 1) * gap; // start 之前的內部 gap

  let length = 0;
  for (let j = start - 1; j < end; j++) length += px(j);
  length += (end - start) * gap; // start..end 之間的內部 gap

  return { offset, length };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- src/grid/trackPx.test.ts`
Expected: PASS(4 tests)。

- [ ] **Step 5: Commit**

```bash
git add src/grid/trackPx.ts src/grid/trackPx.test.ts
git commit -m "feat(grid): trackSpanPx — convert track range to cross-axis px"
```

---

## Task 3: Splitter 接受 cross-axis 子範圍

**Files:**
- Modify: `src/grid/Splitter.tsx`
- Test: `src/grid/Splitter.test.tsx`(新)

- [ ] **Step 1: 寫失敗測試**

建 `src/grid/Splitter.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Splitter } from "./Splitter";

const noop = () => {};

describe("Splitter cross-axis range", () => {
  it("col splitter uses crossStart/crossLength for top/height", () => {
    render(
      <Splitter
        orientation="col"
        pos={100}
        hit={10}
        crossStart={20}
        crossLength={200}
        onDragStart={noop}
        onResize={vi.fn()}
        onDragEnd={noop}
      />,
    );
    const el = screen.getByRole("separator");
    expect(el.style.top).toBe("20px");
    expect(el.style.height).toBe("200px");
    expect(el.style.left).toBe("95px"); // pos - hit/2
    expect(el.style.width).toBe("10px");
  });

  it("row splitter uses crossStart/crossLength for left/width", () => {
    render(
      <Splitter
        orientation="row"
        pos={100}
        hit={10}
        crossStart={20}
        crossLength={200}
        onDragStart={noop}
        onResize={vi.fn()}
        onDragEnd={noop}
      />,
    );
    const el = screen.getByRole("separator");
    expect(el.style.left).toBe("20px");
    expect(el.style.width).toBe("200px");
    expect(el.style.top).toBe("95px");
    expect(el.style.height).toBe("10px");
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- src/grid/Splitter.test.tsx`
Expected: FAIL — `crossStart`/`crossLength` 不是合法 prop(型別錯)或 style 不符(`top` 仍是 `0`)。

- [ ] **Step 3: 實作**

改 `src/grid/Splitter.tsx`:在 `SplitterProps` 加兩個必填 prop,並改 style。

interface 內 `hit` 之後加:

```ts
  /** Cross-axis 起始 px(col→top;row→left)。 */
  crossStart: number;
  /** Cross-axis 長度 px(col→height;row→width)。 */
  crossLength: number;
```

函式參數解構加入 `crossStart, crossLength`。把原本的 `style` 換成:

```ts
  const style: React.CSSProperties = isCol
    ? { left: pos - hit / 2, top: crossStart, width: hit, height: crossLength }
    : { top: pos - hit / 2, left: crossStart, height: hit, width: crossLength };
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- src/grid/Splitter.test.tsx`
Expected: PASS(2 tests)。

- [ ] **Step 5: Commit**

```bash
git add src/grid/Splitter.tsx src/grid/Splitter.test.tsx
git commit -m "feat(grid): Splitter accepts cross-axis sub-range"
```

---

## Task 4: GridHost 依 segments render 多段 Splitter

**Files:**
- Modify: `src/grid/GridHost.tsx`

(無單元測試:GridHost 依賴 `ResizeObserver` 量測,jsdom 下 size 為 0,本專案無 GridHost 單元測試。切段數學已由 Task 1/2 純函式覆蓋;wiring 由 Task 7 原生 GUI 驗證。)

- [ ] **Step 1: 改 import**

在 `src/grid/GridHost.tsx` 既有 import 區加:

```ts
import { boundarySegments } from "./merge";
import { trackSpanPx } from "./trackPx";
```

- [ ] **Step 2: 把 column splitters 換成切段版**

把現有的「Column splitters」`{colCenters.map(...)}` 整塊替換為:

```tsx
      {/* Column splitters — boundary i sits between track i and i+1; render one
          Splitter per run of rows not crossed by a merged cell. */}
      {colCenters.flatMap((pos, i) =>
        boundarySegments(layout.cells, "col", i + 1, rows.length).map((seg) => {
          const { offset, length } = trackSpanPx(rows, areaH, gap, seg.start, seg.end);
          return (
            <Splitter
              key={`col-${i}-${seg.start}`}
              orientation="col"
              pos={pos}
              hit={SPLITTER_HIT}
              crossStart={offset}
              crossLength={length}
              onDragStart={() => (dragStart.current = cols.slice())}
              onResize={(dx) => {
                if (!dragStart.current || areaW <= 0) return;
                const sum = dragStart.current.reduce((a, b) => a + b, 0);
                const dFr = (dx / areaW) * sum;
                setCols(resizeTrack(dragStart.current, i, dFr));
              }}
              onDragEnd={() => (dragStart.current = null)}
            />
          );
        }),
      )}
```

- [ ] **Step 3: 把 row splitters 換成切段版**

把現有的「Row splitters」`{rowCenters.map(...)}` 整塊替換為:

```tsx
      {/* Row splitters. */}
      {rowCenters.flatMap((pos, i) =>
        boundarySegments(layout.cells, "row", i + 1, cols.length).map((seg) => {
          const { offset, length } = trackSpanPx(cols, areaW, gap, seg.start, seg.end);
          return (
            <Splitter
              key={`row-${i}-${seg.start}`}
              orientation="row"
              pos={pos}
              hit={SPLITTER_HIT}
              crossStart={offset}
              crossLength={length}
              onDragStart={() => (dragStart.current = rows.slice())}
              onResize={(dy) => {
                if (!dragStart.current || areaH <= 0) return;
                const sum = dragStart.current.reduce((a, b) => a + b, 0);
                const dFr = (dy / areaH) * sum;
                setRows(resizeTrack(dragStart.current, i, dFr));
              }}
              onDragEnd={() => (dragStart.current = null)}
            />
          );
        }),
      )}
```

- [ ] **Step 4: 型別檢查 + 跑全測試**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck 無誤;所有測試 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/grid/GridHost.tsx
git commit -m "feat(grid): segment boundary splitters around merged cells"
```

---

## Task 5: layoutStore — `selectMode` 狀態

**Files:**
- Modify: `src/store/layoutStore.ts`
- Test: `src/store/layoutStore.test.ts`

- [ ] **Step 1: 寫失敗測試**

在 `src/store/layoutStore.test.ts` 的 `describe("layoutStore", ...)` 內新增:

```ts
  it("toggleSelectMode flips selectMode; turning off clears selection", () => {
    s().toggleSelect(cellId(1, 1));
    expect(s().selectMode).toBe(false);
    s().toggleSelectMode();
    expect(s().selectMode).toBe(true);
    expect(s().selectedIds).toEqual([cellId(1, 1)]); // 開啟不清空
    s().toggleSelectMode();
    expect(s().selectMode).toBe(false);
    expect(s().selectedIds).toEqual([]); // 關閉清空
  });

  it("setSelectMode(false) clears selection", () => {
    s().setSelectMode(true);
    s().toggleSelect(cellId(1, 1));
    s().setSelectMode(false);
    expect(s().selectMode).toBe(false);
    expect(s().selectedIds).toEqual([]);
  });

  it("mergeSelected exits select mode on success", () => {
    s().setSelectMode(true);
    [cellId(1, 1), cellId(2, 1)].forEach((id) => s().toggleSelect(id));
    s().mergeSelected();
    expect(s().selectMode).toBe(false);
    expect(s().selectedIds).toEqual([]);
  });

  it("splitSelected exits select mode on success", () => {
    [cellId(1, 1), cellId(2, 1)].forEach((id) => s().toggleSelect(id));
    s().mergeSelected();
    s().setSelectMode(true);
    s().toggleSelect(cellId(1, 1)); // 選那顆合併格
    s().splitSelected();
    expect(s().selectMode).toBe(false);
    expect(s().selectedIds).toEqual([]);
  });
```

並把檔首 `beforeEach` 的 `setState` 補上 `selectMode: false`:

```ts
beforeEach(() => {
  useLayoutStore.setState({ layout: makePreset(9), selectedIds: [], selectMode: false });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- src/store/layoutStore.test.ts`
Expected: FAIL — `selectMode` 為 undefined / `toggleSelectMode is not a function`。

- [ ] **Step 3: 實作**

在 `src/store/layoutStore.ts`:

(a) `LayoutState` interface 在 `selectedIds: string[];` 之後加:

```ts
  /** 選取模式:開啟時 grid cell 用 overlay 攔截點擊以便選取(ephemeral)。 */
  selectMode: boolean;
```

並在方法宣告區(`clearSelection` 附近)加:

```ts
  setSelectMode: (on: boolean) => void;
  toggleSelectMode: () => void;
```

(b) store 實作:初始 state `selectedIds: [],` 之後加 `selectMode: false,`。在 `clearSelection` 之後加:

```ts
  setSelectMode: (on) =>
    set(() => (on ? { selectMode: true } : { selectMode: false, selectedIds: [] })),

  toggleSelectMode: () =>
    set((s) =>
      s.selectMode ? { selectMode: false, selectedIds: [] } : { selectMode: true },
    ),
```

(c) `mergeSelected` 成功回傳改為:

```ts
      return { layout: after, selectedIds: [], selectMode: false };
```

(d) `splitSelected` 成功回傳改為:

```ts
      return {
        layout: splitCell(s.layout, s.selectedIds[0]),
        selectedIds: [],
        selectMode: false,
      };
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- src/store/layoutStore.test.ts`
Expected: PASS(含既有測試)。

- [ ] **Step 5: Commit**

```bash
git add src/store/layoutStore.ts src/store/layoutStore.test.ts
git commit -m "feat(store): selectMode state + auto-exit on merge/split"
```

---

## Task 6: GridCell — 移除 ◉、加 overlay + Ctrl/Cmd+click

**Files:**
- Modify: `src/grid/GridCell.tsx`
- Test: `src/grid/GridCell.test.tsx`

- [ ] **Step 1: 改寫選取測試（先失敗）**

在 `src/grid/GridCell.test.tsx`,把整個 `describe("select handle", ...)` 區塊(約 line 80–128)替換為:

```tsx
  describe("selection", () => {
    it("no ◉ handle button is rendered (handle removed)", () => {
      render(<GridCell cell={cellOf(cellId(1, 1))} />);
      expect(screen.queryByRole("button", { name: "Select cell" })).toBeNull();
    });

    it("Ctrl+click on the cell toggles selectedIds", () => {
      const id = cellId(1, 1);
      render(<GridCell cell={cellOf(id)} />);
      const cellEl = screen.getByTestId(`cell-${id}`);
      fireEvent.click(cellEl, { ctrlKey: true });
      expect(useLayoutStore.getState().selectedIds).toContain(id);
      fireEvent.click(cellEl, { ctrlKey: true });
      expect(useLayoutStore.getState().selectedIds).not.toContain(id);
    });

    it("Meta(Cmd)+click on the cell toggles selectedIds", () => {
      const id = cellId(1, 1);
      render(<GridCell cell={cellOf(id)} />);
      fireEvent.click(screen.getByTestId(`cell-${id}`), { metaKey: true });
      expect(useLayoutStore.getState().selectedIds).toContain(id);
    });

    it("Ctrl+click does NOT open the picker", () => {
      const id = cellId(1, 1);
      render(<GridCell cell={cellOf(id)} />);
      fireEvent.click(screen.getByTestId(`cell-${id}`), { ctrlKey: true });
      expect(usePanelUiStore.getState().pickerCellId).toBeNull();
    });

    it("select mode: overlay click toggles selectedIds (even on a panel cell)", async () => {
      const id = cellId(1, 1);
      useLayoutStore.getState().setPanel(id, "web", { url: "https://x" });
      useLayoutStore.setState({ selectMode: true });
      render(<GridCell cell={cellOf(id)} />);
      await userEvent.click(screen.getByRole("button", { name: "Select cell" }));
      expect(useLayoutStore.getState().selectedIds).toContain(id);
    });

    it("select mode overlay is absent when selectMode is false", () => {
      useLayoutStore.setState({ selectMode: false });
      render(<GridCell cell={cellOf(cellId(1, 1))} />);
      expect(screen.queryByRole("button", { name: "Select cell" })).toBeNull();
    });

    it("selected cell outer div has ring-2 ring-emerald-400 class", () => {
      const id = cellId(1, 1);
      render(<GridCell cell={cellOf(id)} />);
      const cellEl = screen.getByTestId(`cell-${id}`);
      expect(cellEl.className).not.toMatch(/ring-2/);
      fireEvent.click(cellEl, { ctrlKey: true });
      expect(cellEl.className).toMatch(/ring-2/);
      expect(cellEl.className).toMatch(/ring-inset/);
      expect(cellEl.className).toMatch(/ring-emerald-400/);
    });
  });
```

並把檔首 `beforeEach` 的 `useLayoutStore.setState(...)` 補上 `selectMode: false`:

```ts
  useLayoutStore.setState({ layout: makePreset(4), selectedIds: [], selectMode: false });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- src/grid/GridCell.test.tsx`
Expected: FAIL — ◉ 仍在(「no ◉ handle」失敗)、Ctrl+click 無效、overlay 不存在。

- [ ] **Step 3: 實作**

改 `src/grid/GridCell.tsx`:

(a) 取得 `selectMode`。在 `const selectedIds = useLayoutStore((s) => s.selectedIds);` 之後加:

```ts
  const selectMode = useLayoutStore((s) => s.selectMode);
```

(b) 外層 `<div>`:加 `onClickCapture`(Ctrl/Cmd+click 選取,capture phase 攔在內部按鈕之前),並把 className 改成含 select 模式提示。把現有 outer div 的 `onDragOver`/`onDrop`/`className`/`data-testid` 那段改為:

```tsx
    <div
      style={{
        gridColumn: `${cell.col} / span ${cell.colSpan}`,
        gridRow: `${cell.row} / span ${cell.rowSpan}`,
      }}
      onClickCapture={(e) => {
        if (e.ctrlKey || e.metaKey) {
          e.stopPropagation();
          e.preventDefault();
          toggleSelect(cell.id);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={`group relative overflow-hidden rounded-md border bg-white/[0.03] ${
        isSelected
          ? "border-emerald-400 ring-2 ring-inset ring-emerald-400"
          : selectMode
            ? "border-white/10 ring-1 ring-inset ring-white/20"
            : "border-white/10"
      }`}
      data-testid={`cell-${cell.id}`}
    >
```

(c) 移除舊的 ◉ button:刪掉整段(原本約 line 67–78):

```tsx
      <button
        aria-label="Select cell"
        onClick={(e) => {
          e.stopPropagation();
          toggleSelect(cell.id);
        }}
        className={`absolute left-1 top-1 z-10 rounded bg-black/50 px-1.5 py-0.5 text-xs text-white/80 hover:text-white ${
          isSelected ? "flex" : "hidden group-hover:flex group-focus-within:flex"
        }`}
      >
        ◉
      </button>
```

(d) 在 return 的 JSX 最後、緊接外層 `</div>` 之前加 select 模式 overlay:

```tsx
      {selectMode && (
        <button
          aria-label="Select cell"
          onClick={(e) => {
            e.stopPropagation();
            toggleSelect(cell.id);
          }}
          className="absolute inset-0 z-20 cursor-pointer"
        />
      )}
```

(放在 `cell.panel ? ... : ...` 那段三元式之後、外層 div 收尾前。)

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- src/grid/GridCell.test.tsx`
Expected: PASS(selection describe 全綠 + 其餘既有測試不變)。

- [ ] **Step 5: Commit**

```bash
git add src/grid/GridCell.tsx src/grid/GridCell.test.tsx
git commit -m "feat(grid): cell selection via select-mode overlay + Ctrl/Cmd+click; drop ◉ handle"
```

---

## Task 7: Toolbar — Select toggle 按鈕 + Esc

**Files:**
- Modify: `src/components/Toolbar.tsx`
- Test: `src/components/Toolbar.test.tsx`

- [ ] **Step 1: 寫失敗測試**

在 `src/components/Toolbar.test.tsx` 檔尾新增一個 describe:

```ts
describe("Toolbar — select mode", () => {
  it("Select button toggles selectMode and reflects aria-pressed", () => {
    render(<Toolbar />);
    const btn = screen.getByRole("button", { name: "Select" });
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(useLayoutStore.getState().selectMode).toBe(true);
    expect(btn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn);
    expect(useLayoutStore.getState().selectMode).toBe(false);
  });

  it("Escape exits select mode", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(useLayoutStore.getState().selectMode).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useLayoutStore.getState().selectMode).toBe(false);
  });
});
```

並把檔首 `beforeEach` 的 `useLayoutStore.setState({...})` 補上 `selectMode: false`(該測試檔有覆寫 `loadLayout`,保留既有欄位,只多加一個):

```ts
  useLayoutStore.setState({
    layout: layout4,
    selectedIds: [],
    selectMode: false,
    loadLayout: mockLoadLayout,
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- src/components/Toolbar.test.tsx`
Expected: FAIL — 找不到名為 "Select" 的 button。

- [ ] **Step 3: 實作**

改 `src/components/Toolbar.tsx`:

(a) 檔首 import 改:`import { useEffect, useState } from "react";`

(b) 在既有的 store 取值區(`const clearSelection = ...` 附近)加:

```ts
  const selectMode = useLayoutStore((s) => s.selectMode);
  const toggleSelectMode = useLayoutStore((s) => s.toggleSelectMode);
  const setSelectMode = useLayoutStore((s) => s.setSelectMode);
```

(c) 在 `const [pendingPreset, ...]` 之後加 Esc 監聽:

```ts
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectMode(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectMode, setSelectMode]);
```

(d) 在「`<div className="mx-1 h-4 w-px bg-white/10" />`(Layout 與 Merge 之間的分隔線)」之後、`<button onClick={mergeSelected}...>` 之前,插入 Select 按鈕:

```tsx
      <button
        onClick={toggleSelectMode}
        aria-pressed={selectMode}
        className={`rounded border px-2.5 py-1 text-xs ${
          selectMode
            ? "border-emerald-400 bg-emerald-400/10 text-emerald-300"
            : "border-white/10 text-white/70 hover:border-emerald-400/50 hover:text-white"
        }`}
      >
        Select
      </button>
```

- [ ] **Step 4: 跑測試確認通過 + 全測試 + 型別**

Run: `pnpm test -- src/components/Toolbar.test.tsx`
Expected: PASS。

Run: `pnpm typecheck && pnpm test`
Expected: typecheck 無誤;全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/Toolbar.tsx src/components/Toolbar.test.tsx
git commit -m "feat(toolbar): Select mode toggle button + Esc to exit"
```

---

## Task 8: README 更新 + 原生 GUI 驗證

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README 更新（委派 Sonnet subagent）**

依專案 CLAUDE.md「renew docs 委派 Sonnet」規則,把 README post-v1「Cell-select handle」段落改寫,反映新機制。委派 prompt 附:變更摘要(◉ 把手移除;改 Select 模式按鈕 + Ctrl/Cmd+click)、受影響路徑(`Toolbar.tsx`/`GridCell.tsx`/`layoutStore.ts`)、要記錄的限制(Web/iframe panel 的格無法用 Ctrl+click 選取,需用 Select 模式),以及 splitter bug 已修(merge 後分隔線消失)。要求回傳改動段落摘要供主對話輕量比對。commit message 結尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

- [ ] **Step 2: 啟動 dev 並原生驗證**

依 `verify-tauri-gui` 配方(branch 已切到 `post-v1-splitter-merge-selection`):
```
DISPLAY=:0 pnpm tauri dev   # run_in_background
```
等視窗出現後 `wmctrl -ia`,以「全螢幕截圖 + PIL crop GreedGrid 視窗區域」驗證(避開 focus/遮擋)。

- [ ] **Step 3: 驗收清單(逐項截圖確認)**

1. **Bug 修復**:放 Terminal 於一格 → Select/Ctrl+click 選兩相鄰格 → Merge → 放大截圖確認**合併處 splitter 分隔線消失**。
2. **Split 還原**:選合併格 → Split → 分隔線回來、可拖。
3. **Select 模式**:按 Select 按鈕(高亮)→ 點兩個相鄰格(其一放 Web/iframe panel)→ 兩格皆被選(emerald ring)→ Merge 成功 → 確認**自動退出 select 模式**(按鈕回灰)。
4. **Ctrl+click**:非 select 模式,Ctrl+左鍵點兩個空格 → 皆選取 → Merge 成功。
5. **◉ 已移除**:hover cell 不再出現 ◉ 把手。
6. **Esc**:進 select 模式按 Esc → 退出。

- [ ] **Step 4: 全測試 + 型別最終把關**

Run: `pnpm typecheck && pnpm test`
Expected: 全綠。

- [ ] **Step 5: 收尾**

GUI 驗證截圖留存 `/tmp`。確認 branch `post-v1-splitter-merge-selection` 上所有 commit 完成。後續是否 ff-merge 進 main 由使用者決定(沿用本專案慣例,`superpowers:finishing-a-development-branch`)。

---

## Self-Review notes

- **Spec 覆蓋**:§1 splitter 切段 → Task 1–4;§2.1 Select 模式 → Task 5(store)+ 6(overlay)+ 7(按鈕/Esc);§2.2 Ctrl/Cmd+click → Task 6;§2.3 移除 ◉ → Task 6;§3 測試/驗證 → 各 task TDD + Task 8 GUI;§4 受影響檔案全部對應到 task。
- **型別一致**:`boundarySegments(cells, axis, boundaryIndex, crossTrackCount)`、`SplitterSegment {start,end}`、`trackSpanPx(tracks, areaPx, gap, start, end) → {offset,length}`、store `selectMode`/`setSelectMode`/`toggleSelectMode` 在 Task 1/2/5 定義,Task 4/6/7 使用處簽章一致。
- **無 placeholder**:每個 code step 皆為完整可貼程式碼。
