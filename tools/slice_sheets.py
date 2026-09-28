#!/usr/bin/env python3
"""ตัด sheet ภาพจาก GPT เป็นไฟล์แยกชิ้นตาม asset-src/manifest.yaml (docs/GAME_PLAN.md หัวข้อ 15)

ขั้นตอน (หัวข้อ 15.3):
  1. โหลด sheet และแยกพื้นหลัง (ใช้ alpha ที่มี หรือ flood fill พื้นขาวจากขอบภาพ ไม่ลบสีขาวในตัวภาพ)
  2. หาเส้นแบ่งช่องจากแนวที่ว่างที่สุดใกล้เส้นตารางที่คาดไว้ (ตัด/คัดชิ้นส่วนเล็กที่ล้นมาจากช่องข้าง ๆ ออก)
     ถ้าหาแนวว่างไม่ได้ → เตือนชื่อ sheet (ใช้ --grid-only เพื่อบังคับแบ่งเท่ากัน)
  3. ตัดขอบว่าง จัดกึ่งกลาง เท้าชิดขอบล่าง (มอน/ตัวละคร) ย่อด้วย Lanczos ตามขนาดในหัวข้อ 15.2
  4. บันทึกตามชื่อใน manifest + contact sheet ใน asset-src/_preview/ ให้คนตรวจ
  5. แพ็ก texture atlas (Phaser multiatlas) ใน client/public/atlas/
  6. ประกอบ tileset ของแผนที่ และตรวจว่ามีภาพครบตาม content/

ใช้: python3 tools/slice_sheets.py [--sheet S02.png] [--grid-only] [--bg auto|alpha|white|none]
ต้องมี: pip install -r tools/requirements.txt
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import yaml
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "asset-src"
ASSETS = ROOT / "assets"
PREVIEW = SRC / "_preview"
ATLAS_DIR = ROOT / "client" / "public" / "atlas"
PLACEHOLDER_MANIFEST = ASSETS / "monsters" / ".placeholders.json"

# ขนาดปลายทางต่อ category (หัวข้อ 15.2) — prop = ด้านยาวสุด
SIZES: dict[str, tuple[int, int]] = {
    "monster": (256, 256),
    "character": (128, 128),
    "portrait": (256, 256),
    "prop": (256, 256),
    "icon": (128, 128),
    "vfx": (256, 256),
    "tile": (128, 128),
    "background": (960, 540),
    "keyart": (1536, 864),
}
PADDING = {"monster": 8, "character": 4, "portrait": 6, "prop": 4, "icon": 6, "vfx": 4}
# ชิดขอบล่าง (เท้าอยู่บนพื้น)
BOTTOM_ALIGN = {"monster", "character"}
# ใช้อัตราย่อเดียวกันทั้ง sheet เพื่อคงขนาดเทียบกัน (ร่างเด็กเล็กกว่าร่างโต, เอฟเฟกต์ขยายตามขั้น)
KEEP_SCALE = {"monster", "character", "vfx"}
ALPHA_MIN = 16  # alpha ต่ำกว่านี้ถือว่าโปร่งใส
WHITE_TOL = 12  # ห่างจากสีขาวไม่เกินนี้ถือว่าเป็นพื้นหลัง
GUTTER_WINDOW = 0.22  # ค้นหาเส้นแบ่งในช่วง ±22% ของขนาดช่อง
SEAM_WINDOW = 0.25  # split: seams ค้นหารอยต่อในช่วง ±25% ของขนาดช่อง


@dataclass
class SheetReport:
    name: str
    written: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ---------- 1. พื้นหลัง ----------


def whiteness_distance(rgba: np.ndarray) -> np.ndarray:
    """0 = ขาวสนิท ยิ่งมากยิ่งห่างจากสีขาว"""
    return 255 - rgba[..., :3].astype(np.int16).min(axis=2)


def remove_white_background(rgba: np.ndarray) -> np.ndarray:
    """ลบพื้นขาวด้วย flood fill จากขอบภาพ (สีขาวที่ไม่ติดขอบ เช่น ในตัวมอน จะไม่ถูกลบ) + ลดขอบขาวค้าง (halo)"""
    dist = whiteness_distance(rgba)
    labels, _ = ndimage.label(dist <= WHITE_TOL)
    edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    bg = np.isin(labels, edge[edge > 0])
    out = rgba.copy()
    out[..., 3] = np.where(bg, 0, out[..., 3])
    band = ndimage.binary_dilation(bg, iterations=2) & ~bg
    soft = np.clip((dist.astype(np.float32) - WHITE_TOL) / 60.0, 0, 1)
    out[..., 3] = np.where(band, (out[..., 3] * soft).astype(np.uint8), out[..., 3])
    return out


def load_sheet(path: Path, bg: str) -> tuple[np.ndarray, str]:
    rgba = np.array(Image.open(path).convert("RGBA"))
    mode = bg
    if mode == "auto":
        mode = "alpha" if (rgba[..., 3] < 250).mean() > 0.05 else "white"
    if mode == "white":
        rgba = remove_white_background(rgba)
    return rgba, mode


# ---------- 2. หาเส้นแบ่งช่อง ----------


def find_cuts(profile: np.ndarray, n: int) -> tuple[list[int], list[int]]:
    """ตำแหน่งตัด n ช่องจาก profile (จำนวนพิกเซลที่มีภาพต่อแถว/คอลัมน์) คืน (cuts, ค่าที่ตำแหน่งตัด)"""
    length = len(profile)
    size = length / n
    cuts, residue = [0], []
    for k in range(1, n):
        center = k * size
        lo = max(1, int(center - GUTTER_WINDOW * size))
        hi = min(length - 1, int(center + GUTTER_WINDOW * size))
        seg = profile[lo:hi]
        best_val = seg.min()
        idxs = np.where(seg == best_val)[0] + lo
        cut = int(idxs[np.argmin(np.abs(idxs - center))])
        cuts.append(cut)
        residue.append(int(best_val))
    cuts.append(length)
    return cuts, residue


def grid_cuts(length: int, n: int) -> list[int]:
    return [round(k * length / n) for k in range(n + 1)]


def seam_cuts(rgb: np.ndarray, n: int, axis: int) -> list[int]:
    """เส้นแบ่งของ sheet ที่ช่องชิดกันไม่มีร่อง (เช่น ลายพื้น S08 ที่ GPT วาดแถวสูงไม่เท่ากัน)
    หาตำแหน่งที่พิกเซลสองแถวติดกันต่างกันมากที่สุด (รอยต่อระหว่างลายสองชนิด) ใกล้ตำแหน่งตารางเท่ากัน
    axis 0 = เส้นแนวนอน (แบ่งแถว) · 1 = เส้นแนวตั้ง (แบ่งคอลัมน์)"""
    diff = np.abs(np.diff(rgb.astype(np.int16), axis=axis)).sum(axis=2).mean(axis=1 - axis)
    length = rgb.shape[axis]
    size = length / n
    cuts = [0]
    for k in range(1, n):
        center = k * size
        lo = max(0, int(center - SEAM_WINDOW * size))
        hi = min(len(diff), int(center + SEAM_WINDOW * size))
        cuts.append(int(np.argmax(diff[lo:hi])) + lo + 1)
    cuts.append(length)
    return cuts


def clean_cell(cell: np.ndarray) -> np.ndarray:
    """ลบชิ้นส่วนเล็ก ๆ ที่ติดขอบช่อง (มักเป็นเศษจากช่องข้าง ๆ) โดยเก็บเอฟเฟกต์ลอยตัวที่อยู่ในช่องไว้"""
    mask = cell[..., 3] > ALPHA_MIN
    labels, n = ndimage.label(mask)
    if n <= 1:
        return cell
    sizes = ndimage.sum(mask, labels, range(1, n + 1))
    total = sizes.sum()
    h, w = mask.shape
    out = cell.copy()
    for i, (size, sl) in enumerate(zip(sizes, ndimage.find_objects(labels)), start=1):
        touches = sl[0].start == 0 or sl[1].start == 0 or sl[0].stop == h or sl[1].stop == w
        if touches and size < 0.015 * total:
            out[labels == i, 3] = 0
    return out


def bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.where(mask)
    if len(ys) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def seam(filled: np.ndarray, y0: int, y1: int, x_center: int, cell_w: float) -> np.ndarray:
    """เส้นแบ่งแนวตั้งที่ตัดผ่านภาพน้อยที่สุด (dynamic programming แบบ seam carving) ในช่วง ±GUTTER_WINDOW ของเส้นแบ่ง
    คืนตำแหน่ง x ของเส้นในแต่ละแถว y0..y1-1"""
    half = int(GUTTER_WINDOW * cell_w)
    lo, hi = max(0, x_center - half), min(filled.shape[1], x_center + half)
    cost = filled[y0:y1, lo:hi].astype(np.float64)
    cost += np.abs(np.arange(lo, hi) - x_center)[None, :] * (0.5 / half)  # ชอบอยู่ใกล้เส้นเดิม
    acc = cost.copy()
    back = np.zeros(cost.shape, dtype=np.int8)
    for y in range(1, acc.shape[0]):
        prev = acc[y - 1]
        left = np.r_[np.inf, prev[:-1]]
        right = np.r_[prev[1:], np.inf]
        stack = np.vstack([left, prev, right])
        choice = stack.argmin(axis=0)
        acc[y] += stack[choice, np.arange(len(prev))]
        back[y] = choice - 1
    path = np.zeros(acc.shape[0], dtype=np.int64)
    path[-1] = int(acc[-1].argmin())
    for y in range(acc.shape[0] - 1, 0, -1):
        path[y - 1] = path[y] + back[y, path[y]]
    return path + lo


def partition_map(filled: np.ndarray, ys: list[int], xs_rows: list[list[int]]) -> np.ndarray:
    """แบ่งทั้งภาพเป็นช่องด้วยเส้นโค้งที่ผ่านพิกเซลว่างมากที่สุด: เส้นแนวนอนระหว่างแถว แล้วเส้นแนวตั้งระหว่างคอลัมน์ในแต่ละแถว"""
    h, w = filled.shape
    rows, cols = len(ys) - 1, len(xs_rows[0]) - 1
    cell_h, cell_w = h / rows, w / cols
    yy = np.arange(h)[:, None]
    row_idx = np.zeros((h, w), dtype=np.int32)
    for k in range(1, rows):
        path = seam(filled.T, 0, w, ys[k], cell_h)  # y ของเส้นในแต่ละคอลัมน์ x
        row_idx += (yy >= path[None, :]).astype(np.int32)
    part = np.zeros((h, w), dtype=np.int32)
    xx = np.arange(w)[None, :]
    for r in range(rows):
        col_idx = np.zeros((h, w), dtype=np.int32)
        for k in range(1, cols):
            path = seam(filled, ys[r], ys[r + 1], xs_rows[r][k], cell_w)
            # นอกช่วงแถวที่คำนวณ ใช้ปลายเส้นที่ใกล้ที่สุด
            full = np.concatenate([np.full(ys[r], path[0]), path, np.full(h - ys[r + 1], path[-1])])
            col_idx += (xx >= full[:, None]).astype(np.int32)
        part = np.where(row_idx == r, r * cols + col_idx, part)
    return part


def assign_components(filled: np.ndarray, ys: list[int], xs_rows: list[list[int]], report: SheetReport) -> np.ndarray:
    """ตรวจกลุ่มพิกเซล (connected components) แล้วยกทั้งกลุ่มให้ช่องที่มีพิกเซลส่วนใหญ่ของกลุ่มนั้น
    (ช่องกำหนดด้วยเส้นโค้งที่ผ่านที่ว่างที่สุด จึงไม่ตัดเอฟเฟกต์ที่ล้นเส้นตาราง)
    กลุ่มที่คร่อมหลายช่องจริง ๆ (ภาพ 2 ตัวติดกัน) ถูกแบ่งตามเส้นโค้งแทน และเตือน
    คืน array ขนาดเท่าภาพ: index ของช่อง (r * cols + c) หรือ -1 = พื้นหลัง"""
    labels, n = ndimage.label(filled)
    owners = np.full(filled.shape, -1, dtype=np.int32)
    if n == 0:
        return owners
    part = partition_map(filled, ys, xs_rows)
    cells = (len(ys) - 1) * (len(xs_rows[0]) - 1)
    lab = labels.ravel()
    fg = lab > 0
    counts = np.zeros((n + 1, cells), dtype=np.int64)
    np.add.at(counts, (lab[fg], part.ravel()[fg]), 1)
    totals = counts.sum(axis=1)
    best = counts.argmax(axis=1)
    share = np.divide(counts.max(axis=1), np.maximum(totals, 1))
    whole = share >= 0.8
    lut = np.where(whole, best, -1).astype(np.int32)
    lut[0] = -1
    owners = lut[labels]
    split = (~whole[labels]) & (labels > 0)
    owners[split] = part[split]
    n_split = int((~whole[1:]).sum())
    if n_split:
        report.warnings.append(f"มี {n_split} กลุ่มภาพที่คร่อมหลายช่อง แบ่งตามเส้นโค้งแทน (ตรวจ contact sheet)")
        # เศษเล็กจากการแบ่งที่ไม่ติดกับตัวหลักของช่อง → ทิ้ง
        for cell in np.unique(owners[split]):
            own = owners == cell
            pieces, k = ndimage.label(own)
            if k <= 1:
                continue
            sizes = ndimage.sum(own, pieces, range(1, k + 1))
            from_split = ndimage.maximum(split, pieces, range(1, k + 1))
            for j, (size, fs) in enumerate(zip(sizes, from_split), start=1):
                if fs and size < 0.05 * sizes.max():
                    owners[pieces == j] = -1
    return owners


# ---------- 3. จัดวางและย่อ ----------


def place(content: Image.Image, category: str, scale: float | None) -> Image.Image:
    tw, th = SIZES[category]
    pad = PADDING.get(category, 0)
    box_w, box_h = tw - 2 * pad, th - 2 * pad
    w, h = content.size
    s = scale if scale is not None else min(box_w / w, box_h / h)
    s = min(s, box_w / w, box_h / h)  # ล้นกล่อง (เช่นเอฟเฟกต์ใหญ่) ต้องย่อลงอีก
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    resized = content.resize((nw, nh), Image.LANCZOS)
    if category == "prop":  # ด้านยาวสุด 256 คงสัดส่วน
        canvas = Image.new("RGBA", (nw + 2 * pad, nh + 2 * pad), (0, 0, 0, 0))
        canvas.alpha_composite(resized, (pad, pad))
        return canvas
    canvas = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    x = (tw - nw) // 2
    y = th - pad - nh if category in BOTTOM_ALIGN else (th - nh) // 2
    canvas.alpha_composite(resized, (x, y))
    return canvas


def cover_crop(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """ตัดจากกลางภาพให้ได้สัดส่วนปลายทาง แล้วย่อ"""
    tw, th = size
    w, h = img.size
    target = tw / th
    if w / h > target:
        nw = round(h * target)
        img = img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = round(w / target)
        img = img.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    return img.resize((tw, th), Image.LANCZOS)


# ---------- ชื่อไฟล์ ----------


def cell_names(spec: dict) -> list[list[tuple[str, str]]]:
    """[(ชื่อสำหรับ contact sheet, path ปลายทาง)] ต่อแถว/คอลัมน์"""
    rows, cols, out = spec["rows"], spec["cols"], spec["out"]
    names: list[list[tuple[str, str]]] = []
    if "cellIds" in spec:
        ids = spec["cellIds"]
        if len(ids) != rows * cols:
            raise ValueError(f"cellIds มี {len(ids)} ชื่อ แต่ตารางมี {rows * cols} ช่อง")
        for r in range(rows):
            names.append([(ids[r * cols + c], out.format(id=ids[r * cols + c])) for c in range(cols)])
    else:
        row_ids, col_ids = spec["rowIds"], spec["colIds"]
        if len(row_ids) != rows or len(col_ids) != cols:
            raise ValueError("จำนวน rowIds/colIds ไม่ตรงกับตาราง")
        for r in range(rows):
            names.append([(f"{row_ids[r]}/{col_ids[c]}", out.format(row=row_ids[r], col=col_ids[c])) for c in range(cols)])
    return names


# ---------- ตัด 1 sheet ----------


def slice_sheet(name: str, spec: dict, args: argparse.Namespace) -> tuple[SheetReport, list[tuple[str, Image.Image]]]:
    report = SheetReport(name)
    path = SRC / name
    if not path.exists():
        report.warnings.append("ไม่พบไฟล์ sheet")
        return report, []
    rows, cols = spec["rows"], spec["cols"]
    category = spec["category"]
    row_categories = spec.get("rowCategories", [category] * rows)
    bg = args.bg or spec.get("bg", "auto")
    rgba, mode = load_sheet(path, bg)
    h, w = rgba.shape[:2]
    names = cell_names(spec)

    split = "grid" if args.grid_only else spec.get("split", "gutter")
    if mode == "none":
        filled = whiteness_distance(rgba) > WHITE_TOL
    else:
        filled = rgba[..., 3] > ALPHA_MIN
    # เส้นแบ่งแถวจากทั้งภาพ แล้วเส้นแบ่งคอลัมน์แยกตามแต่ละแถว (แต่ละแถวจัดวางไม่เท่ากัน)
    if split == "grid":
        ys = grid_cuts(h, rows)
        xs_rows = [grid_cuts(w, cols) for _ in range(rows)]
    elif split == "seams":
        ys = seam_cuts(rgba[..., :3], rows, 0)
        xs_rows = [seam_cuts(rgba[..., :3], cols, 1)] * rows
    else:
        ys, _ = find_cuts(filled.sum(axis=1), rows)
        xs_rows = [find_cuts(filled[ys[r] : ys[r + 1]].sum(axis=0), cols)[0] for r in range(rows)]
    owners = None
    if mode != "none" and split == "gutter":
        owners = assign_components(filled, ys, xs_rows, report)

    # อัตราย่อเดียวกันทั้ง sheet สำหรับหมวดที่ต้องคงขนาดเทียบกัน
    cell_w, cell_h = w / cols, h / rows
    sheet_scale = {}
    for cat in set(row_categories):
        if cat in KEEP_SCALE:
            tw, th = SIZES[cat]
            pad = PADDING.get(cat, 0)
            sheet_scale[cat] = min((tw - 2 * pad) / cell_w, (th - 2 * pad) / cell_h)

    pieces: list[tuple[str, Image.Image]] = []
    for r in range(rows):
        cat = row_categories[r]
        for c in range(cols):
            label, out_rel = names[r][c]
            xs = xs_rows[r]
            if owners is not None:
                # เอาเฉพาะพิกเซลของกลุ่มที่เป็นของช่องนี้ (อาจล้นเส้นแบ่งได้ เช่น เอฟเฟกต์โจมตี)
                own = owners == r * cols + c
                box = bbox(own)
                if box is None:
                    report.warnings.append(f"{label}: ช่องว่าง ไม่พบภาพ")
                    continue
                x0, y0, x1, y1 = box
                cell = rgba[y0:y1, x0:x1].copy()
                cell[..., 3] = np.where(own[y0:y1, x0:x1], cell[..., 3], 0)
            else:
                cell = rgba[ys[r] : ys[r + 1], xs[c] : xs[c + 1]]
            if cat == "tile":
                ch, cw = cell.shape[:2]
                m = round(min(ch, cw) * 0.03)  # ตัดขอบในกันสีช่องข้าง ๆ ติดมา
                img = Image.fromarray(cell[m : ch - m, m : cw - m]).convert("RGBA").resize(SIZES[cat], Image.LANCZOS)
            elif cat in ("background", "keyart"):
                box = bbox(whiteness_distance(cell) > WHITE_TOL)
                if box is None:
                    report.warnings.append(f"{label}: ช่องว่าง")
                    continue
                img = cover_crop(Image.fromarray(cell).convert("RGB").crop(box), SIZES[cat]).convert("RGBA")
            else:
                if owners is None:
                    cell = clean_cell(cell)
                box = bbox(cell[..., 3] > ALPHA_MIN)
                if box is None:
                    report.warnings.append(f"{label}: ช่องว่าง ไม่พบภาพ")
                    continue
                img = place(Image.fromarray(cell).crop(box), cat, sheet_scale.get(cat))
            dest = ROOT / out_rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.suffix == ".webp":  # ฉาก/ภาพใหญ่ไม่ต้องโปร่งใส → webp เล็กกว่า PNG มาก
                img.convert("RGB").save(dest, quality=85, method=6)
            else:
                img.save(dest, optimize=True)
            report.written.append(out_rel)
            pieces.append((label, img))
    return report, pieces


# ---------- 4. contact sheet ----------


def contact_sheet(name: str, pieces: list[tuple[str, Image.Image]], cols: int) -> Path:
    thumb, label_h = 128, 16
    rows = (len(pieces) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * thumb, rows * (thumb + label_h)), (40, 44, 58))
    draw = ImageDraw.Draw(sheet)
    for i, (label, img) in enumerate(pieces):
        x, y = (i % cols) * thumb, (i // cols) * (thumb + label_h)
        # พื้นลายตารางหมากรุก เพื่อเห็นพื้นหลังที่ค้าง
        checker = Image.new("RGBA", (thumb, thumb), (70, 74, 90, 255))
        cd = ImageDraw.Draw(checker)
        for cy in range(0, thumb, 16):
            for cx in range(0, thumb, 16):
                if (cx + cy) // 16 % 2:
                    cd.rectangle((cx, cy, cx + 15, cy + 15), fill=(95, 99, 115, 255))
        t = img.copy()
        t.thumbnail((thumb, thumb), Image.LANCZOS)
        checker.alpha_composite(t, ((thumb - t.width) // 2, (thumb - t.height) // 2))
        sheet.paste(checker.convert("RGB"), (x, y))
        draw.text((x + 3, y + thumb + 2), label[:22], fill=(230, 230, 230))
    PREVIEW.mkdir(parents=True, exist_ok=True)
    out = PREVIEW / f"{Path(name).stem}_contact.png"
    sheet.save(out)
    return out


# ---------- 5. atlas ----------


def build_atlas(atlas: str, entries: list[tuple[str, Path]], page_size: int = 2048) -> list[Path]:
    """แพ็กภาพขนาดเท่ากันเป็นตาราง หลายหน้า (Phaser multiatlas JSON)"""
    if not entries:
        return []
    imgs = [(frame, Image.open(p).convert("RGBA")) for frame, p in entries]
    fw = max(i.width for _, i in imgs)
    fh = max(i.height for _, i in imgs)
    per_row, per_col = page_size // fw, page_size // fh
    per_page = per_row * per_col
    ATLAS_DIR.mkdir(parents=True, exist_ok=True)
    for old in ATLAS_DIR.glob(f"{atlas}-*.*"):
        old.unlink()
    textures, files = [], []
    for page, start in enumerate(range(0, len(imgs), per_page)):
        chunk = imgs[start : start + per_page]
        rows_used = (len(chunk) + per_row - 1) // per_row
        canvas = Image.new("RGBA", (min(len(chunk), per_row) * fw, rows_used * fh), (0, 0, 0, 0))
        frames = []
        for i, (frame, im) in enumerate(chunk):
            x, y = (i % per_row) * fw, (i // per_row) * fh
            canvas.alpha_composite(im, (x, y))
            frames.append(
                {
                    "filename": frame,
                    "frame": {"x": x, "y": y, "w": im.width, "h": im.height},
                    "rotated": False,
                    "trimmed": False,
                    "spriteSourceSize": {"x": 0, "y": 0, "w": im.width, "h": im.height},
                    "sourceSize": {"w": im.width, "h": im.height},
                }
            )
        # webp (คุณภาพ 90 มี alpha) เล็กกว่า PNG ราว 4–5 เท่า โหลดเร็วบน Chromebook/มือถือ
        image_name = f"{atlas}-{page}.webp"
        canvas.save(ATLAS_DIR / image_name, quality=90, method=6)
        files.append(ATLAS_DIR / image_name)
        textures.append({"image": image_name, "format": "RGBA8888", "size": {"w": canvas.width, "h": canvas.height}, "scale": 1, "frames": frames})
    meta = ATLAS_DIR / f"{atlas}.json"
    meta.write_text(json.dumps({"textures": textures, "meta": {"app": "tools/slice_sheets.py", "version": "1"}}, indent=1) + "\n")
    files.append(meta)
    return files


def atlas_entries(manifest: dict, atlas: str) -> list[tuple[str, Path]]:
    """ทุกภาพของ atlas นี้ที่มีอยู่บนดิสก์ (ชื่อ frame = path สัมพัทธ์ในโฟลเดอร์หมวด ไม่มีนามสกุล เช่น puibai/f1_idle)"""
    entries = []
    for name, spec in manifest.items():
        if name.startswith("_") or spec.get("atlas") != atlas:
            continue
        for row in cell_names(spec):
            for _, out_rel in row:
                p = ROOT / out_rel
                if p.exists():
                    rel = Path(out_rel).relative_to(Path(out_rel).parts[0], Path(out_rel).parts[1])
                    entries.append((rel.with_suffix("").as_posix(), p))
    return entries


# ---------- 6. tileset + ตรวจความครบ ----------


def build_tilesets(manifest: dict) -> list[str]:
    written = []
    for name, cfg in (manifest.get("_tilesets") or {}).items():
        size, cols = cfg["tileSize"], cfg["columns"]
        tiles = cfg["tiles"]
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * size, rows * size), (0, 0, 0, 0))
        for i, rel in enumerate(tiles):
            src = ASSETS / f"{rel}.png"
            if not src.exists():
                print(f"  ⚠ tileset {name}: ไม่มี {src.relative_to(ROOT)}")
                continue
            im = Image.open(src).convert("RGBA")
            if rel.startswith("tiles/"):
                # ตัดขอบ 10% (ขอบช่องจาก sheet มักมีเส้น ทำให้เห็นรอยต่อเป็นตาราง) — ตรงกับ tools/make-world-map.ts
                m = round(im.width * 0.1)
                tile = im.crop((m, m, im.width - m, im.height - m)).resize((size, size), Image.LANCZOS)
            else:  # ของประดับ: ย่อให้พอดีช่อง ชิดล่าง พื้นโปร่งใส
                im.thumbnail((size, size), Image.LANCZOS)
                tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
                tile.alpha_composite(im, ((size - im.width) // 2, size - im.height))
            sheet.alpha_composite(tile, ((i % cols) * size, (i // cols) * size))
        out = ROOT / cfg["out"]
        out.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(out, optimize=True)
        written.append(cfg["out"])
    return written


def completeness() -> list[str]:
    """มอนทุกตัวต้องมีครบ 6 ภาพ ไอเท็มทุกตัวต้องมีไอคอน NPC ต้องมีภาพ ฉากต่อสู้ต้องมีภาพ"""
    missing = []
    content = ROOT / "content"
    for f in sorted((content / "monsters").glob("*.json")):
        m = json.loads(f.read_text())
        for form in m["forms"]:
            for pose in ("idle", "attack"):
                p = ASSETS / "monsters" / m["id"] / f"f{form['form']}_{pose}.png"
                if not p.exists():
                    missing.append(str(p.relative_to(ROOT)))
    for item in json.loads((content / "items.json").read_text())["items"]:
        p = ASSETS / "items" / f"{item['icon']}.png"
        if not p.exists():
            missing.append(f"{p.relative_to(ROOT)} (ไอเท็ม {item['id']})")
    for npc in json.loads((content / "npcs.json").read_text())["npcs"]:
        for key in ("sprite", "portrait"):
            p = ASSETS / "npcs" / f"{npc[key]}.png"
            if not p.exists():
                missing.append(str(p.relative_to(ROOT)))
    bgs = {z["battleBackground"] for z in json.loads((content / "zones.json").read_text())["zones"]}
    bgs |= {d["battleBackground"] for d in json.loads((content / "dungeons.json").read_text())["dungeons"]}
    for bg in sorted(bgs):
        p = ASSETS / "backgrounds" / f"{bg}.webp"
        if not p.exists():
            missing.append(str(p.relative_to(ROOT)))
    return missing


def forget_placeholders(written: list[str]):
    """ไฟล์ที่เป็นภาพจริงแล้ว ห้ามให้ npm run placeholders เขียนทับ"""
    if not PLACEHOLDER_MANIFEST.exists():
        return
    listed = json.loads(PLACEHOLDER_MANIFEST.read_text())
    real = {str(Path(p).relative_to("assets")) for p in written if p.startswith("assets/")}
    kept = [p for p in listed if p not in real]
    PLACEHOLDER_MANIFEST.write_text(json.dumps(kept, indent=2) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sheet", help="ทำเฉพาะ sheet นี้ เช่น S02.png")
    ap.add_argument("--grid-only", action="store_true", help="บังคับแบ่งตารางเท่ากัน")
    ap.add_argument("--bg", choices=["auto", "alpha", "white", "none"], help="บังคับวิธีแยกพื้นหลัง")
    args = ap.parse_args()

    manifest = yaml.safe_load((SRC / "manifest.yaml").read_text())
    sheets = [n for n in manifest if not n.startswith("_")]
    if args.sheet:
        if args.sheet not in manifest:
            print(f"ไม่มี {args.sheet} ใน manifest")
            return 1
        sheets = [args.sheet]

    all_written: list[str] = []
    total_warn = 0
    for name in sheets:
        spec = manifest[name]
        report, pieces = slice_sheet(name, spec, args)
        expected = spec["rows"] * spec["cols"]
        preview = contact_sheet(name, pieces, spec["cols"]) if pieces else None
        status = "✔" if len(report.written) == expected and not report.warnings else "⚠"
        print(f"{status} {name}: {len(report.written)}/{expected} ชิ้น" + (f" · ตรวจ {preview.relative_to(ROOT)}" if preview else ""))
        for w in report.warnings:
            print(f"    ⚠ {w}")
        total_warn += len(report.warnings)
        all_written += report.written

    forget_placeholders(all_written)

    atlases = sorted({spec["atlas"] for n, spec in manifest.items() if not n.startswith("_") and spec.get("atlas")})
    for atlas in atlases:
        files = build_atlas(atlas, atlas_entries(manifest, atlas))
        if files:
            print(f"✔ atlas {atlas}: {', '.join(str(f.relative_to(ROOT)) for f in files)}")

    for out in build_tilesets(manifest):
        print(f"✔ tileset {out}")

    missing = completeness()
    if missing:
        print(f"⚠ ยังขาดภาพ {len(missing)} ไฟล์:")
        for m in missing[:20]:
            print(f"    - {m}")
    else:
        print("✔ ภาพครบตาม content/ (มอนสเตอร์ ไอเท็ม NPC ฉากต่อสู้)")
    print(f"สรุป: เขียน {len(all_written)} ไฟล์ · คำเตือน {total_warn} · ขาด {len(missing)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
