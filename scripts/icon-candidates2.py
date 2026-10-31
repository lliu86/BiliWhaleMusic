"""图标候选（第二版）：几何鲸 / 音符鲸尾 / 脸特写 / 字母 B + 鲸尾"""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(BASE, 'assets', 'whale', 'whale.png')
OUT = os.path.join(BASE, 'shots')
os.makedirs(OUT, exist_ok=True)

src = Image.open(ART).convert('RGBA')
w, h = src.size
head = src.crop((int(w * 0.05), int(h * 0.03), int(w * 0.97), int(h * 0.82)))
head = head.crop(head.getbbox())

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def tile(S, c1, c2, radius=0.23):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    g = Image.new('RGBA', (S, S)); d = g.load()
    for y in range(S):
        for x in range(S):
            d[x, y] = (*lerp(c1, c2, (x + y) / (2 * S - 2)), 255)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius), fill=255)
    img.paste(g, (0, 0), mask)
    return img

# ---------- 1. 几何鲸：白色圆鲸 + 尾鳍 + 眼睛 + 喷水 ----------
def whale_glyph(d, cx, cy, s, color, eye):
    body = [cx - s * 0.52, cy - s * 0.34, cx + s * 0.34, cy + s * 0.34]
    d.ellipse(body, fill=color)
    # 尾鳍（右侧两个叶）
    d.polygon([(cx + s * 0.30, cy - s * 0.02), (cx + s * 0.72, cy - s * 0.42),
               (cx + s * 0.60, cy + s * 0.02), (cx + s * 0.74, cy + s * 0.26)], fill=color)
    # 胸鳍
    d.polygon([(cx - s * 0.10, cy + s * 0.22), (cx - s * 0.34, cy + s * 0.46),
               (cx + s * 0.02, cy + s * 0.34)], fill=color)
    # 眼睛
    d.ellipse([cx - s * 0.34, cy - s * 0.14, cx - s * 0.20, cy], fill=eye)
    # 喷水
    for i, (dx, dy, r) in enumerate([(-0.02, -0.52, 0.055), (-0.14, -0.60, 0.04), (0.10, -0.60, 0.04)]):
        d.ellipse([cx + s * dx - s * r, cy + s * dy - s * r,
                   cx + s * dx + s * r, cy + s * dy + s * r], fill=color)

def make_1(S):
    base = tile(S, (74, 94, 255), (146, 84, 246))
    d = ImageDraw.Draw(base)
    whale_glyph(d, S * 0.50, S * 0.53, S * 0.36, (255, 255, 255, 255), (74, 94, 255, 255))
    return base

# ---------- 2. 音符鲸尾：八分音符，尾部变成鲸尾双叶 ----------
def make_2(S):
    base = tile(S, (10, 14, 34), (44, 26, 96))
    d = ImageDraw.Draw(base)
    white = (255, 255, 255, 255)
    accent = (110, 224, 255, 255)
    # 音符头
    r = S * 0.115
    hx, hy = S * 0.40, S * 0.66
    d.ellipse([hx - r * 1.15, hy - r, hx + r * 1.05, hy + r], fill=white)
    # 符干
    d.rectangle([hx + r * 0.62, S * 0.30, hx + r * 1.02, hy], fill=white)
    # 鲸尾双叶（顶部）
    tx, ty = hx + r * 0.82, S * 0.30
    d.polygon([(tx, ty), (tx - S * 0.16, ty - S * 0.18), (tx - S * 0.05, ty - S * 0.20)], fill=white)
    d.polygon([(tx, ty), (tx + S * 0.17, ty - S * 0.15), (tx + S * 0.06, ty - S * 0.21)], fill=white)
    # 水花小点
    d.ellipse([S * 0.68, S * 0.16, S * 0.72, S * 0.20], fill=accent)
    d.ellipse([S * 0.75, S * 0.24, S * 0.79, S * 0.28], fill=accent)
    return base

# ---------- 3. 脸特写：浅底 + 眼睛区域 ----------
def make_3(S):
    base = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.23), fill=255)
    base.paste(Image.new('RGBA', (S, S), (238, 243, 255, 255)), (0, 0), m)
    # 取头部的「眼睛 + 刘海」区域（相对 bbox 的中上部）
    hw, hh = head.size
    face = head.crop((int(hw * 0.16), int(hh * 0.30), int(hw * 0.86), int(hh * 0.72)))
    face = face.crop(face.getbbox())
    sc = (S * 1.02) / face.width
    im = face.resize((int(face.width * sc), int(face.height * sc)), Image.LANCZOS)
    x = (S - im.width) // 2
    y = int(S * 0.10)
    base.alpha_composite(im, (x, y))
    return base

# ---------- 4. 字母 B + 鲸尾 ----------
def make_4(S):
    base = tile(S, (12, 18, 46), (58, 40, 130))
    d = ImageDraw.Draw(base)
    white = (255, 255, 255, 255)
    accent = (120, 226, 255, 255)
    # 用两条圆角竖笔 + 两个半圆拼出 B
    lw = int(S * 0.085)
    left = int(S * 0.30); top = int(S * 0.24); bottom = int(S * 0.76)
    d.rounded_rectangle([left, top, left + lw, bottom], radius=lw // 2, fill=white)
    r1 = int(S * 0.155); r2 = int(S * 0.175)
    cy1 = top + r1; cy2 = bottom - r2
    d.arc([left + lw - 2, cy1 - r1, left + lw + r1 * 2, cy1 + r1], -90, 90, fill=white, width=lw)
    d.arc([left + lw - 2, cy2 - r2, left + lw + r2 * 2, cy2 + r2], -90, 90, fill=white, width=lw)
    # 右下角鲸尾点缀
    tx, ty = left + lw + r2 * 1.55, cy2 + r2 * 0.55
    d.polygon([(tx, ty), (tx + S * 0.14, ty - S * 0.10), (tx + S * 0.05, ty - S * 0.13)], fill=accent)
    return base

MAKERS = [('1 几何小鲸', make_1), ('2 音符鲸尾', make_2), ('3 脸特写', make_3), ('4 字母 B + 尾鳍', make_4)]

for name, fn in MAKERS:
    k = name[0]
    fn(256).save(os.path.join(OUT, f'cand{k}-256.png'))
    fn(32).save(os.path.join(OUT, f'cand{k}-32.png'))

# ---------- 对比图 ----------
CELL, PAD, LABEL = 240, 20, 30
sheet_w = CELL + PAD * 2 + 4 * 96 + 90
sheet_h = (CELL + LABEL + PAD) * len(MAKERS) + PAD
sheet = Image.new('RGBA', (sheet_w, sheet_h), (248, 249, 252, 255))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 17)
    small_font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 13)
except Exception:
    font = small_font = ImageFont.load_default()

for i, (name, fn) in enumerate(MAKERS):
    y = PAD + i * (CELL + LABEL + PAD)
    d.text((PAD, y), name, fill=(24, 24, 32, 255), font=font)
    sheet.alpha_composite(fn(CELL), (PAD, y + LABEL))
    x = PAD + CELL + 20
    for px in (16, 24, 32, 48):
        up = fn(px).resize((px * 2 * (48 // px) // 2 * 2, px * 2 * (48 // px) // 2 * 2), Image.NEAREST)
        up = fn(px).resize((96, 96), Image.NEAREST)
        sheet.alpha_composite(up, (x, y + LABEL + (CELL - 96) // 2 + 10))
        d.text((x + 12, y + LABEL + (CELL - 96) // 2 + 112), f'{px}px', fill=(110, 110, 120, 255), font=small_font)
        x += 100

sheet.convert('RGB').save(os.path.join(OUT, 'icon-candidates2.png'))
print('v2 saved')
