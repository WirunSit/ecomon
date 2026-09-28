#!/usr/bin/env python3
"""วาดพื้นของแผนที่ Tiled เป็นภาพเดียว (ขอบโค้งเป็นธรรมชาติ ลายไม่ซ้ำเป็นตาราง มีฟองคลื่นริมน้ำ)

ช่องของแผนที่ยังใช้ตัดสินการเดินเหมือนเดิม — สคริปต์นี้เปลี่ยนแค่ "ภาพ" ของพื้น
ชนิดพื้นของแต่ละช่องมาจาก property "material" ของ tile ใน tileset (ตั้งใน Tiled)
วิธีวาดแต่ละชนิดอยู่ใน asset-src/terrain.yaml · ภาพพื้นผิวมาจาก assets/tiles/src/ (npm run assets)

ผลลัพธ์: assets/maps/<id>/ground.json + ground_<cx>_<cy>.webp (แบ่งเป็นชิ้นไม่เกิน chunk px)
รันใหม่ทุกครั้งที่แก้แผนที่: npm run render-maps (npm run validate จะเตือนถ้าภาพพื้นเก่ากว่าแผนที่)

ใช้: python3 tools/render_maps.py [--map test_island]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zlib
from pathlib import Path

import numpy as np
import yaml
from PIL import Image
from scipy import ndimage

# Windows ที่ตั้งภาษาไทยใช้ cp874 เป็นค่าเริ่มต้น → บังคับ UTF-8 ให้พิมพ์ข้อความไทย/สัญลักษณ์ได้
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")


ROOT = Path(__file__).resolve().parent.parent
MAPS = ROOT / "content" / "maps"
TEXTURES = ROOT / "assets" / "tiles" / "src"
OUT = ROOT / "assets" / "maps"
CONFIG = ROOT / "asset-src" / "terrain.yaml"


def source_hash(tmj: Path) -> str:
    """ต้องตรงกับ tools/validate.ts (ใช้ตรวจว่าภาพพื้นเก่ากว่าแผนที่ไหม)"""
    return hashlib.sha1(tmj.read_bytes() + b"\n" + CONFIG.read_bytes()).hexdigest()


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / max(e1 - e0, 1e-6), 0, 1)
    return t * t * (3 - 2 * t)


def fbm(h: int, w: int, cell: float, rng: np.random.Generator, octaves: int = 3) -> np.ndarray:
    """noise แบบหลายความถี่ ค่า 0..1"""
    out = np.zeros((h, w), np.float32)
    amp, total = 1.0, 0.0
    for _ in range(octaves):
        gh, gw = int(h / cell) + 3, int(w / cell) + 3
        grid = rng.random((gh, gw)).astype(np.float32)
        up = ndimage.zoom(grid, cell, order=3)[:h, :w]
        out += amp * up
        total += amp
        amp *= 0.5
        cell = max(2.0, cell / 2)
    out /= total
    return np.clip((out - out.mean()) / (out.std() * 4 + 1e-6) + 0.5, 0, 1)


# ---------- ภาพพื้นผิว ----------


class Texture:
    """ชิ้นภาพพื้นผิวสำหรับวางกระจาย (texture bombing) หลายแบบ: หมุน/กลับด้าน + ขอบนุ่มวงกลม"""

    def __init__(self, name: str, patch: int, rotate: bool, soften: float = 0.0):
        img = Image.open(TEXTURES / f"{name}.png").convert("RGB")
        arr = np.asarray(img.resize((patch, patch), Image.LANCZOS), np.float32)
        self.mean = arr.reshape(-1, 3).mean(axis=0)
        # ลดความตัดกันของลายเล็ก ๆ (เข้าใกล้สีเฉลี่ย) ให้พื้นไม่ยุบยับแย่งสายตาจากตัวละคร
        arr = arr * (1 - soften) + self.mean * soften
        variants = []
        for k in range(4 if rotate else 1):
            r = np.rot90(arr, k)
            variants += [r, r[:, ::-1]]
        self.variants = [np.ascontiguousarray(v) for v in variants]
        yy, xx = np.mgrid[0:patch, 0:patch]
        rr = np.hypot(yy - (patch - 1) / 2, xx - (patch - 1) / 2) / (patch / 2)
        self.alpha = np.clip((1 - rr) / 0.4, 0, 1).astype(np.float32)[..., None]
        self.patch = patch

    def bomb(self, h: int, w: int, mask: np.ndarray, rng: np.random.Generator) -> np.ndarray:
        """วาดพื้นผิวเต็มพื้นที่ h×w (ข้ามส่วนที่ mask = 0)"""
        p = self.patch
        out = np.empty((h + p, w + p, 3), np.float32)
        out[:] = self.mean
        step = p * 0.42
        points = [(y, x) for y in np.arange(-p / 2, h, step) for x in np.arange(-p / 2, w, step)]
        rng.shuffle(points)
        for y, x in points:
            y = int(y + rng.uniform(-step / 2, step / 2)) + p // 2
            x = int(x + rng.uniform(-step / 2, step / 2)) + p // 2
            y = min(max(y, 0), h)
            x = min(max(x, 0), w)
            my0, mx0 = max(0, y - p // 2), max(0, x - p // 2)
            if not mask[my0 : min(h, y + p // 2), mx0 : min(w, x + p // 2)].any():
                continue
            v = self.variants[rng.integers(len(self.variants))]
            dst = out[y : y + p, x : x + p]
            dst *= 1 - self.alpha
            dst += v * self.alpha
        half = p // 2
        return out[half : half + h, half : half + w]


# ---------- แผนที่ ----------


def load_map(path: Path):
    tmj = json.loads(path.read_text(encoding="utf-8"))
    layers = {l["name"]: l for l in tmj["layers"]}
    w, h, t = tmj["width"], tmj["height"], tmj["tilewidth"]
    materials: dict[int, str] = {}
    for ts in tmj["tilesets"]:
        for tile in ts.get("tiles", []):
            props = {p["name"]: p["value"] for p in tile.get("properties", [])}
            if "material" in props:
                materials[ts["firstgid"] + tile["id"]] = props["material"]
    grid = lambda name: np.array(layers[name]["data"], np.int64).reshape(h, w) & 0x1FFFFFFF
    ground = grid("ground")
    mat = np.full((h, w), "", dtype=object)
    for gid, name in materials.items():
        mat[ground == gid] = name
    mat[grid("water_shallow") > 0] = "shallow"
    mat[grid("water_deep") > 0] = "deep"
    return mat, w, h, t


def soft_mask(tiles: np.ndarray, t: int, blur: float, noise: float, feather: float, noise_field: np.ndarray) -> np.ndarray:
    """mask ขอบนุ่มระดับพิกเซลจากช่องที่เป็นพื้นชนิดนี้ (ขอบโค้ง + noise) — ช่องเดี่ยวยังเห็นเป็นหย่อมกลม ๆ"""
    up = np.kron(tiles.astype(np.float32), np.ones((t, t), np.float32))
    field = ndimage.gaussian_filter(up, sigma=max(blur, 0.01) * t) if blur else up
    # ช่องเดี่ยว ๆ (เช่นหย่อมดอกไม้) จะจางหายเมื่อเบลอ → รวมกับหย่อมกลมกลางช่อง
    yy, xx = np.mgrid[0:t, 0:t]
    blob = np.clip(1.25 - np.hypot(yy - (t - 1) / 2, xx - (t - 1) / 2) / (t * 0.45), 0, 1).astype(np.float32)
    field = np.maximum(field, np.tile(blob, tiles.shape) * up * 0.75)
    if noise:
        field = field + (noise_field - 0.5) * noise
    return smoothstep(0.5 - feather, 0.5 + feather, field)


def render(path: Path, cfg: dict) -> dict:
    mat, w, h, t = load_map(path)
    if t != cfg["tileSize"]:
        raise ValueError(f"{path.name}: ขนาดช่อง {t} ไม่ตรงกับ terrain.yaml ({cfg['tileSize']})")
    H, W = h * t, w * t
    seed = cfg["seed"] ^ zlib.crc32(path.stem.encode())
    rng = np.random.default_rng(seed)
    materials: dict = cfg["materials"]
    names = list(materials)
    base = names[0]

    unknown = sorted(set(mat.ravel()) - set(names) - {""})
    if unknown:
        print(f"  ⚠ ไม่รู้จัก material: {', '.join(unknown)} (เพิ่มใน terrain.yaml) — วาดเป็น {base}")

    def texture(name: str) -> Texture:
        m = materials[name]
        return Texture(m["texture"], m.get("patch", 96), m.get("rotate", True), m.get("soften", 0.0))

    everywhere = np.ones((H, W), bool)
    canvas = texture(base).bomb(H, W, everywhere, rng)
    canvas *= 1 + cfg.get("variation", 0) * (fbm(H, W, t * 6, rng)[..., None] * 2 - 1)

    shore = cfg.get("shore", {})
    water_names = set(shore.get("water", []))
    water_tiles = np.isin(mat, list(water_names)) if water_names else np.zeros_like(mat, bool)
    # สะพานที่มีน้ำขนาบสองข้างถือว่าอยู่เหนือน้ำ → วาดน้ำใต้สะพานต่อเนื่อง (ไม่เว้าเป็นพื้นดิน)
    crisp = [n for n in names if materials[n].get("crisp")]
    if crisp and water_tiles.any():
        over = np.isin(mat, crisp)
        pad = np.pad(water_tiles, 1)
        lr = pad[1:-1, :-2] & pad[1:-1, 2:]
        ud = pad[:-2, 1:-1] & pad[2:, 1:-1]
        water_tiles = water_tiles | (over & (lr | ud))
    edge_noise = fbm(H, W, t * 1.3, rng)
    water_alpha = None

    for name in names[1:]:
        m = materials[name]
        tiles = mat == name
        if name in water_names and name == shore.get("water", [None])[0]:
            tiles = water_tiles  # น้ำตื้นวาดใต้น้ำลึกทั้งหมด แล้วค่อยทับด้วยน้ำลึก
        if not tiles.any():
            continue
        if m.get("crisp"):
            canvas = paint_crisp(canvas, tiles, m, t)
            continue
        alpha = soft_mask(tiles, t, m.get("blur", 0.5), m.get("noise", 0.3), m.get("feather", 0.08), edge_noise)
        if name in water_names and water_alpha is None:
            water_alpha = alpha
            canvas = paint_wet_sand(canvas, alpha, shore)
        tex = texture(name).bomb(H, W, alpha > 0.001, rng)
        a = alpha[..., None]
        canvas = canvas * (1 - a) + tex * a

    if water_alpha is not None:
        canvas = paint_foam(canvas, water_alpha, shore, edge_noise)
        # สะพานต้องทับฟองคลื่น → วาดชนิด crisp ซ้ำอีกรอบหลังฟอง
        for name in names[1:]:
            if materials[name].get("crisp") and (mat == name).any():
                canvas = paint_crisp(canvas, mat == name, materials[name], t)

    return {"canvas": np.clip(canvas, 0, 255).astype(np.uint8), "width": W, "height": H, "tileSize": t}


def paint_wet_sand(canvas: np.ndarray, water_alpha: np.ndarray, shore: dict) -> np.ndarray:
    """ทรายเปียกเข้มขึ้นเป็นแถบบนฝั่งติดน้ำ"""
    water = water_alpha > 0.5
    dist_out = ndimage.distance_transform_edt(~water)
    wet = np.clip(1 - dist_out / shore.get("wetWidth", 6), 0, 1) * shore.get("wetAlpha", 0.3)
    wet = (wet * (~water))[..., None]
    return canvas * (1 - wet) + np.array(shore.get("wet", [120, 100, 64]), np.float32) * wet


def paint_foam(canvas: np.ndarray, water_alpha: np.ndarray, shore: dict, noise: np.ndarray) -> np.ndarray:
    """ฟองคลื่นตามแนวขอบน้ำ + น้ำใสขึ้นใกล้ฝั่ง"""
    water = water_alpha > 0.5
    dist_in = ndimage.distance_transform_edt(water)
    dist_out = ndimage.distance_transform_edt(~water)
    glow = np.clip(1 - dist_in / shore.get("shoreGlow", 10), 0, 1) * 0.28 * water
    canvas = canvas * (1 - glow[..., None]) + np.array([220, 250, 255], np.float32) * glow[..., None]
    d = np.where(water, dist_in, dist_out)
    foam = np.clip(1 - d / shore.get("foamWidth", 2.5), 0, 1) * shore.get("foamAlpha", 0.8)
    foam *= 0.55 + 0.9 * noise  # ฟองขาดเป็นช่วง ๆ
    foam = np.clip(foam, 0, 1)[..., None]
    return canvas * (1 - foam) + np.array(shore.get("foam", [255, 255, 255]), np.float32) * foam


def paint_crisp(canvas: np.ndarray, tiles: np.ndarray, m: dict, t: int) -> np.ndarray:
    """วาดทีละช่องแบบคม (สะพาน) หมุนตามแนวที่ต่อกัน + เงาบนพื้นด้านล่าง"""
    img = Image.open(TEXTURES / f"{m['texture']}.png").convert("RGBA").resize((t, t), Image.LANCZOS)
    vertical = np.asarray(img, np.float32)
    horizontal = np.asarray(img.rotate(90), np.float32)
    shadow = int(m.get("shadow", 0))
    h, w = tiles.shape
    out = canvas.copy()
    if shadow:
        sh = np.zeros(canvas.shape[:2], np.float32)
        for y, x in zip(*np.nonzero(tiles)):
            sh[y * t + shadow : (y + 1) * t + shadow, x * t + shadow : (x + 1) * t + shadow] = 0.35
        sh = ndimage.gaussian_filter(sh, 2)[..., None]
        out *= 1 - sh
    for y, x in zip(*np.nonzero(tiles)):
        horiz = (x > 0 and tiles[y, x - 1]) or (x < w - 1 and tiles[y, x + 1])
        vert = (y > 0 and tiles[y - 1, x]) or (y < h - 1 and tiles[y + 1, x])
        src = horizontal if horiz and not vert else vertical
        a = src[..., 3:4] / 255
        dst = out[y * t : (y + 1) * t, x * t : (x + 1) * t]
        dst[:] = dst * (1 - a) + src[..., :3] * a
    return out


def save(path: Path, result: dict, cfg: dict) -> list[Path]:
    out_dir = OUT / path.stem
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("ground_*.webp"):
        old.unlink()
    size = cfg.get("chunk", 2048)
    canvas = result["canvas"]
    chunks, files = [], []
    for cy in range(0, result["height"], size):
        for cx in range(0, result["width"], size):
            part = canvas[cy : cy + size, cx : cx + size]
            name = f"ground_{cx // size}_{cy // size}.webp"
            Image.fromarray(part).save(out_dir / name, quality=88, method=6)
            chunks.append({"x": cx, "y": cy, "w": part.shape[1], "h": part.shape[0], "file": name})
            files.append(out_dir / name)
    meta = {
        "map": path.stem,
        "width": result["width"],
        "height": result["height"],
        "tileSize": result["tileSize"],
        "chunks": chunks,
        "source": source_hash(path),
    }
    (out_dir / "ground.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8")
    files.append(out_dir / "ground.json")
    return files


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--map", help="วาดเฉพาะแผนที่นี้ (id = ชื่อไฟล์ไม่รวม .tmj)")
    args = ap.parse_args()
    cfg = yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    paths = sorted(MAPS.glob("*.tmj"))
    if args.map:
        paths = [p for p in paths if p.stem == args.map]
        if not paths:
            print(f"ไม่พบแผนที่ {args.map}")
            return 1
    for path in paths:
        result = render(path, cfg)
        files = save(path, result, cfg)
        print(f"✔ {path.name}: {result['width']}×{result['height']} px → {', '.join(str(f.relative_to(ROOT)) for f in files)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
