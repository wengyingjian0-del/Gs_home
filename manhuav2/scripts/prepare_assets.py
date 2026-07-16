from pathlib import Path
from PIL import Image

SOURCE = Path(r"D:\Pictures\Saved Pictures")
TARGET = Path(__file__).resolve().parents[1] / "public" / "assets"
FILES = {
    "豆包.png": "empty-character.webp",
    "豆包 (1).png": "character-builder.webp",
    "豆包 (2).png": "scenes-grid.webp",
    "豆包 (3).png": "success.webp",
    "豆包 (4).png": "parent-menu.webp",
    "豆包 (5).png": "feature-hub.webp",
    "豆包 (6).png": "start-story.webp",
    "豆包 (7).png": "pixel-character.webp",
    "豆包 (8).png": "comic-creator.webp",
}

TARGET.mkdir(parents=True, exist_ok=True)
for source_name, target_name in FILES.items():
    with Image.open(SOURCE / source_name) as image:
        image = image.convert("RGB")
        image.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
        image.save(TARGET / target_name, "WEBP", quality=88, method=6)
