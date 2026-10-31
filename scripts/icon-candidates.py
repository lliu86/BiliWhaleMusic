"""生成图标候选方案：A 负形剪影 / B 霓虹描边 / C 脸特写 / D 几何鲸尾音标"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageFont

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(BASE, 'assets', 'whale', 'whale.png')
OUT = os.path.join(BASE, 'shots')
os.makedirs(OUT, exist_ok=True)

src = Image.open(ART).convert('RGBA')
# 取头部（含发饰/肩），按 bbox 裁紧
w, h = src.size
head = src.crop((int(w * 0.06), int(h * 0.04), int(w * 0.96), int(h * 0.80)))
head = head.crop(head.getbbox())

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def grad_tile(S, c1, c2, radius=0.24, diag=True):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    g = Image.new('RGBA', (S, S))
    d = g.load()
    for y in range(S):
        for x in range(S):
            t = ((x + y) / (2 * S - 2)) if diag else (y / (S - 1))
            d[x, y] = (*lerp(c1, c2, t), 255)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius), fill=255)
    img.paste(g, (0, 0), mask)
    return img, mask

def fit(img, S, ratio, anchor='center'):
    box = S * ratio
    sc = box / max(img.width, img.height)
    im = img.resize((max(1, int(img.width * sc)), max(1, int(img.height * sc))), Image.LANCZOS)
    x = (S - im.width) // 2
    y = (S - im.height) // 2 if anchor == 'center' else S - im.height - int(S * (1 - ratio) / 2)
    return im, x, y

def silhouette(color, alpha, size=None):
    a = alpha if size is None else alpha.resize(size, Image.LANCZOS)
    layer = Image.new('RGBA', a.size, (*color, 255))
    layer.putalpha(a)
    return layer

def outline(color, alpha, width, size=None):
    """alpha 边缘：膨胀 - 原图"""
    if size is not None:
        alpha = alpha.resize(size, Image.LANCZOS)
    dil = alpha.filter(ImageFilter.MaxFilter(width * 2 + 1))
    edge = ImageChops.subtract(dil, alpha)
    layer = Image.new('RGBA', alpha.size, (*color, 255))
    layer.putalpha(edge)
    return layer

def rounded_mask(S, ratio, radius=0.24):
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius), fill=255)
    return m

# ---------------- A 负形剪影：渐变底 + 纯白剪影 ----------------
def make_A(S):
    base, _ = grad_tile(S, (86, 102, 255), (150, 92, 246))
    sil, x, y = fit(silhouette((255, 255, 255), head.getchannel('A')), S, 0.74)
    base.alpha_composite(sil, (x, y))
    # 底部一条极淡的高光，避免太平
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(hl)
    d.ellipse([-S * 0.4, S * 0.72, S * 1.4, S * 1.5], fill=(255, 255, 255, 26))
    base.alpha_composite(hl)
    return base

# ---------------- B 霓虹描边：近黑底 + 青紫描边 ----------------
def make_B(S):
    base, _ = grad_tile(S, (8, 12, 28), (22, 18, 52), radius=0.26)
    a = head.getchannel('A')
    inner, x, y = fit(silhouette((34, 40, 74), a), S, 0.70)
    base.alpha_composite(inner, (x, y))
    edge, x2, y2 = fit(outline((96, 214, 255), a, max(1, S // 96)), S, 0.70)
    base.alpha_composite(edge, (x2, y2))
    return base

# ---------------- C 脸特写：浅底 + 高对比卡通脸 ----------------
def make_C(S):
    base = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    base.paste(Image.new('RGBA', (S, S), (245, 247, 255, 255)), (0, 0), rounded_mask(S, 0.24))
    zoom = head.crop((int(head.width * 0.10), int(head.height * 0.06),
                      int(head.width * 0.92), int(head.height * 0.62)))
    zoom = zoom.crop(zoom.getbbox())
    im, x, y = fit(zoom, S, 0.88)
    base.alpha_composite(im, (x, y))
    return base

# ---------------- D 几何：深底 + 白色鲸尾 + 音符 ----------------
def whale_tail(draw, cx, cy, s, color):
    """两个水滴状尾叶 + 中间缺口，近似鲸尾"""
    draw.polygon([(cx, cy + s * 0.70), (cx - s * 0.95, cy - s * 0.30),
                  (cx - s * 0.62, cy - s * 0.62), (cx - s * 0.12, cy - s * 0.18)], fill=color)
    draw.polygon([(cx, cy + s * 0.70), (cx + s * 0.95, cy - s * 0.30),
                  (cx + s * 0.62, cy - s * 0.62), (cx + s * 0.12, cy - s * 0.18)], fill=color)

def make_D(S):
    base, _ = grad_tile(S, (18, 22, 58), (58, 38, 120), radius=0.26)
    d = ImageDraw.Draw(base)
    whale_tail(d, S * 0.5, S * 0.52, S * 0.30, (255, 255, 255, 255))
    # 音符：一个实心圆 + 竖杆 + 小旗
    r = S * 0.085
    nx, ny = S * 0.66, S * 0.62
    d.ellipse([nx - r, ny - r, nx + r, ny + r], fill=(120, 220, 255, 255))
    d.rectangle([nx + r * 0.62, ny - S * 0.30, nx + r * 1.15, ny], fill=(120, 220, 255, 255))
    d.polygon([(nx + r * 1.15, ny - S * 0.30), (nx + r * 2.2, ny - S * 0.18),
               (nx + r * 1.15, ny - S * 0.10)], fill=(120, 220, 255, 255))
    return base

MAKERS = [('A 渐变+白剪影', make_A), ('B 暗底+霓虹描边', make_B),
          ('C 浅底+脸特写', make_C), ('D 几何鲸尾+音符', make_D)]

# 输出单张 256 + 小尺寸预览
for name, fn in MAKERS:
    key = name[0]
    big = fn(256)
    big.save(os.path.join(OUT, f'cand-{key}-256.png'))
    fn(32).save(os.path.join(OUT, f'cand-{key}-32.png'))

# 拼对比图：每行一个方案，左侧 256，右侧 64/32/16 实际像素放大展示
CELL = 256
PAD = 18
LABEL_H = 26
cols = 4
rows = len(MAKERS)
sheet = Image.new('RGBA', (CELL + 300 + PAD * 2, (CELL + PAD) * rows + PAD), (250, 250, 252, 255))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 18)
except Exception:
    font = ImageFont.load_default()

for i, (name, fn) in enumerate(MAKERS):
    y = PAD + i * (CELL + PAD)
    big = fn(CELL)
    sheet.alpha_composite(big, (PAD, y))
    d.text((PAD, y - 0), name, fill=(20, 20, 30, 255), font=font)
    # 小尺寸：16/24/32/48 放大到同一高度
    x = CELL + PAD + 16
    for px in (16, 24, 32, 48):
        small = fn(px)
        scale = 96 // px
        up = small.resize((px * scale, px * scale), Image.NEAREST)
        sheet.alpha_composite(up, (x, y + (CELL - up.height) // 2))
        d.text((x, y + CELL - 22), f'{px}px', fill=(90, 90, 100, 255), font=font)
        x += up.width + 16

sheet.convert('RGB').save(os.path.join(OUT, 'icon-candidates.png'))
print('saved candidates + sheet')
