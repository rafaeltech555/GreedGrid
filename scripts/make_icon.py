"""
GreedGrid app icon generator.

Draws a 1024×1024 RGBA PNG: a dark rounded-rect background (slate #0b0f14),
a 3×3 grid of cells with subtle white grid lines, and one cell
(row 1, col 2 — middle row, right column) filled with emerald-400 (#34d399).

Usage:
    python3 scripts/make_icon.py
Output:
    src-tauri/icons/greedgrid-source.png  (1024×1024, RGBA)
"""

from pathlib import Path
from PIL import Image, ImageDraw

SIZE = 1024
MARGIN = SIZE // 12           # ~85 px padding around the rounded rect
CORNER_RADIUS = SIZE // 8     # ~128 px radius
GRID_N = 3                    # 3×3 grid

# App palette
BG_COLOR     = (11, 15, 20, 255)    # #0b0f14 (slate-950-ish)
LINE_COLOR   = (255, 255, 255, 45)  # white, low opacity — subtle grid
ACCENT_COLOR = (52, 211, 153, 255)  # #34d399  emerald-400

# Accented cell: row=1, col=2 (0-indexed) — middle row, right column.
# Off-centre focal point that reads well at all sizes.
ACCENT_ROW = 1
ACCENT_COL = 2

LINE_WIDTH = max(4, SIZE // 128)  # ~8 px at 1024; stays visible when scaled


def composite(base: Image.Image, layer: Image.Image) -> Image.Image:
    """Alpha-composite layer on top of base (both RGBA, same size)."""
    return Image.alpha_composite(base, layer)


def main() -> None:
    out_path = (
        Path(__file__).parent.parent / "src-tauri" / "icons" / "greedgrid-source.png"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # --- Layer 1: dark rounded-rect background ---
    base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(base).rounded_rectangle(
        [MARGIN, MARGIN, SIZE - MARGIN, SIZE - MARGIN],
        radius=CORNER_RADIUS,
        fill=BG_COLOR,
    )

    # Grid geometry
    box_x0 = MARGIN
    box_y0 = MARGIN
    box_x1 = SIZE - MARGIN
    box_y1 = SIZE - MARGIN
    cell_w = (box_x1 - box_x0) / GRID_N
    cell_h = (box_y1 - box_y0) / GRID_N

    # --- Layer 2: accent cell ---
    # The cell sits well inside the rounded rect at 1024 px, so no extra clipping.
    accent = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    cx0 = int(box_x0 + ACCENT_COL * cell_w)
    cy0 = int(box_y0 + ACCENT_ROW * cell_h)
    cx1 = int(cx0 + cell_w)
    cy1 = int(cy0 + cell_h)
    ImageDraw.Draw(accent).rectangle([cx0, cy0, cx1, cy1], fill=ACCENT_COLOR)
    base = composite(base, accent)

    # --- Layer 3: grid lines (interior — 2 vertical + 2 horizontal) ---
    lines = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lines)
    for i in range(1, GRID_N):
        x = int(box_x0 + i * cell_w)
        ld.line([(x, box_y0), (x, box_y1)], fill=LINE_COLOR, width=LINE_WIDTH)
        y = int(box_y0 + i * cell_h)
        ld.line([(box_x0, y), (box_x1, y)], fill=LINE_COLOR, width=LINE_WIDTH)
    base = composite(base, lines)

    base.save(out_path, "PNG")
    print(f"Saved {out_path}  ({base.width}×{base.height})")


if __name__ == "__main__":
    main()
