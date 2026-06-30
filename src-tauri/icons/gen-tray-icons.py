"""Generate GreedGrid tray icons (neutral + idle) as 32x32 RGBA PNGs.
Run once: `python3 src-tauri/icons/gen-tray-icons.py`. Deterministic output."""
from PIL import Image, ImageDraw

def draw(color, out):
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # laptop screen
    d.rounded_rectangle([6, 8, 26, 21], radius=2, outline=color, width=2)
    # laptop base
    d.line([3, 24, 29, 24], fill=color, width=2)
    # two z's (idle hint), drawn for both states; colour conveys idle
    d.line([20, 4, 24, 4], fill=color, width=2)
    d.line([24, 4, 20, 8], fill=color, width=2)
    d.line([20, 8, 24, 8], fill=color, width=2)
    img.save(out)

# neutral gray, amber (#fbbf24)
draw((139, 148, 158, 255), "src-tauri/icons/tray-neutral.png")
draw((251, 191, 36, 255), "src-tauri/icons/tray-idle.png")
print("wrote tray-neutral.png + tray-idle.png")
