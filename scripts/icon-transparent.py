"""把图标改成「透明底 + 角色本体」：生成 icon.png / tray.png / icon.ico 及预览"""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(BASE, 'assets', 'whale', 'whale.png')
OUT = os.path.join(BASE, 'shots')
ASSETS = os.path.join(BASE, 'assets')

src = Image.open(ART).convert('RGBA')
w, h = src.size
# 与旧图标相同的取景（头部+肩），再按 bbox 裁紧
cut = src.crop((int(w * 0.05), int(h * 0.03), int(w * 0.97), int(h * 0.82)))
cut = cut.crop(cut.getbbox())
print('cut', cut.size)

def make(S, ratio=0.92):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    box = S * ratio
    sc = box / max(cut.width, cut.height)
    im = cut.resize((max(1, round(cut.width * sc)), max(1, round(cut.height * sc))), Image.LANCZOS)
    img.alpha_composite(im, ((S - im.width) // 2, (S - im.height) // 2))
    return img

make(256).save(os.path.join(ASSETS, 'icon.png'))
make(32).save(os.path.join(ASSETS, 'tray.png'))

make(256).save(os.path.join(ASSETS, 'icon.ico'),
               sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# ---------- 预览：透明棋盘 / 深色 / 浅色 + 小尺寸 ----------
def checker(W, H, cell=10):
    img = Image.new('RGBA', (W, H), (255, 255, 255, 255))
    d = ImageDraw.Draw(img)
    for y in range(0, H, cell):
        for x in range(0, W, cell):
            if ((x // cell) + (y // cell)) % 2:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(226, 229, 236, 255))
    return img

CELL = 220
PAD = 22
rows = [('透明底（棋盘）', checker(CELL, CELL)), ('深色任务栏', Image.new('RGBA', (CELL, CELL), (14, 18, 30, 255))),
        ('浅色背景', Image.new('RGBA', (CELL, CELL), (245, 247, 255, 255)))]
sheet = Image.new('RGBA', (CELL * 3 + PAD * 4 + 260, CELL * 2 + PAD * 3), (250, 250, 252, 255))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 16)
except Exception:
    font = ImageFont.load_default()

for i, (name, bg) in enumerate(rows):
    x = PAD + i * (CELL + PAD)
    bg = bg.copy()
    bg.alpha_composite(make(CELL))
    sheet.alpha_composite(bg, (x, PAD + 26))
    d.text((x, PAD), name, fill=(30, 30, 40, 255), font=font)

# 左下：不同尺寸并排
y2 = PAD + 26 + CELL + PAD
xs = PAD
for px in (16, 24, 32, 48, 64):
    up = make(px).resize((96, 96), Image.NEAREST)
    sheet.alpha_composite(up, (xs, y2 + 6))
    d.text((xs + 34, y2 + 106), f'{px}px', fill=(100, 100, 110, 255), font=font)
    xs += 104

sheet.convert('RGB').save(os.path.join(OUT, 'icon-transparent-preview.png'))
print('done')
