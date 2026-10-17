# Cat Jam PWA ikonu uretici ( Pillow ) — gorsel iyilestirme v2
from PIL import Image, ImageDraw
import math, os

BG = (17, 18, 20, 255)
FUR = (243, 165, 72, 255)
INNER = (248, 180, 160, 255)
EYE = (255, 243, 218, 255)
PUPIL = (34, 28, 20, 255)

def rounded_bg(size, radius_ratio):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=BG)
    return img

def thick_arc(d, cx, cy, r, a0, a1, width, color, steps=40):
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        x = cx + r * math.cos(a)
        y = cy + r * math.sin(a)
        d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=color)

def draw_cat(size, img, pad_ratio):
    d = ImageDraw.Draw(img)
    pad = size * pad_ratio
    s = size - 2 * pad
    cx = size / 2 - s * 0.04
    cy = size / 2 + s * 0.03
    hr = s * 0.36

    # kuyruk: sagda yukari kivrilmis kalın yay (yuvarlak uçlu)
    tw = s * 0.075
    tx, ty = cx + hr * 1.02, cy + hr * 0.55
    thick_arc(d, tx, ty, hr * 0.72, 210, -55, tw, FUR)

    # kulaklar (kafadan once, icleri sonra)
    ear_w = hr * 0.78
    ear_h = hr * 0.78
    for sx in (-1, 1):
        base_x = cx + sx * hr * 0.66
        tip_x = cx + sx * hr * 1.02
        tip_y = cy - hr - ear_h * 0.62
        d.polygon([(base_x, cy - hr * 0.62), (tip_x, tip_y), (base_x + sx * ear_w * 0.62, cy - hr * 0.7)], fill=FUR)

    # kafa
    d.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=FUR)

    # ic kulaklar
    for sx in (-1, 1):
        base_x = cx + sx * hr * 0.70
        tip_x = cx + sx * hr * 0.94
        tip_y = cy - hr - ear_h * 0.34
        d.polygon([(base_x, cy - hr * 0.66), (tip_x, tip_y), (base_x + sx * hr * 0.34, cy - hr * 0.72)], fill=INNER)

    # gozler
    ey = cy + hr * 0.06
    er = hr * 0.15
    for sx in (-1, 1):
        ex = cx + sx * hr * 0.40
        d.ellipse([ex - er, ey - er, ex + er, ey + er], fill=EYE)
        pr = er * 0.6
        d.ellipse([ex - pr, ey - pr, ex + pr, ey + pr], fill=PUPIL)
        # goz parıltısı
        sp = er * 0.22
        d.ellipse([ex - pr + sp * 1.2, ey - pr + sp * 1.2, ex - pr + sp * 2.6, ey - pr + sp * 2.6], fill=(255, 255, 255, 230))

    # burun
    ny = cy + hr * 0.44
    nw = hr * 0.14
    d.polygon([(cx - nw, ny), (cx + nw, ny), (cx, ny + nw * 1.25)], fill=INNER)
    # ağız
    mw = max(2, int(s * 0.02))
    d.arc([cx - nw * 1.6, ny, cx, ny + nw * 1.7], start=0, end=90, fill=(180, 110, 80, 255), width=mw)
    d.arc([cx, ny, cx + nw * 1.6, ny + nw * 1.7], start=90, end=180, fill=(180, 110, 80, 255), width=mw)

    # bıyıklar: yanlardan dışa doğru kısa
    wl = hr * 0.5
    w = max(2, int(s * 0.018))
    for sx in (-1, 1):
        bx = cx + sx * hr * 0.96
        for i, dy in enumerate((-0.22, 0.0, 0.22)):
            y1 = ny + nw * 0.2 + dy * hr * 0.2
            y2 = ny + nw * 0.2 + dy * hr * 0.44
            d.line([bx, y1, bx + sx * wl, y2], fill=INNER, width=w)

def make(size, name, maskable=False):
    img = rounded_bg(size, 0.0 if maskable else 0.22)
    draw_cat(size, img, pad_ratio=0.26 if maskable else 0.14)
    img.save(name, "PNG")
    print("wrote", name)

os.chdir(os.path.dirname(os.path.abspath(__file__)))
make(512, "public/icons/cat-512.png")
make(192, "public/icons/cat-192.png")
make(512, "public/icons/cat-512-maskable.png", maskable=True)
make(180, "public/icons/apple-touch-icon.png")
print("done")
