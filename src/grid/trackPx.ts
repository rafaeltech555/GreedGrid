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
  const px = (i: number) => (tracks[i] / sum) * areaPx;

  let offset = 0;
  for (let j = 0; j < start - 1; j++) offset += px(j);
  offset += (start - 1) * gap;

  let length = 0;
  for (let j = start - 1; j < end; j++) length += px(j);
  length += (end - start) * gap;

  return { offset, length };
}
