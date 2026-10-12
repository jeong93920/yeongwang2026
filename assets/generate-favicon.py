"""BASAK WITCH 파비콘 생성 — 고깔모자를 쓴 마녀 얼굴. 외부 라이브러리 없이 PNG를 직접 씁니다."""
import os, struct, zlib

BG = (0x3B, 0x2A, 0x5C)       # 밤하늘 보라
HAT = (0x1E, 0x1A, 0x22)      # 모자
BAND = (0xF2, 0x91, 0x1E)     # 모자 띠 (오렌지)
FACE = (0x8C, 0xC6, 0x5A)     # 마녀 얼굴
SHADE = (0x6E, 0xA8, 0x40)    # 코
HAIR = (0x7A, 0x3E, 0x9D)     # 머리카락
EYE = (0x1E, 0x1A, 0x22)

SIZE = 512
SS = 3                         # 슈퍼샘플링 배율
N = SIZE * SS


def ellipse(x, y, cx, cy, rx, ry):
    dx = (x - cx) / rx
    dy = (y - cy) / ry
    return dx * dx + dy * dy <= 1.0


def triangle(x, y, a, b, c):
    def side(p, q):
        return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])
    d1, d2, d3 = side(a, b), side(b, c), side(c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


# 모자: 넓은 챙 + 끝이 오른쪽으로 꺾인 고깔
CONE = ((150, 262), (362, 262), (282, 74))
TIP = ((262, 120), (300, 86), (392, 112))
BAND_Y = (214, 250)


def in_cone(x, y):
    return triangle(x, y, *CONE)


def sample(x, y):
    """SIZE 좌표계의 한 점 색을 돌려줍니다."""
    # 챙
    if ellipse(x, y, 256, 270, 212, 34):
        return HAT
    # 고깔과 꺾인 끝
    if in_cone(x, y):
        return BAND if BAND_Y[0] <= y <= BAND_Y[1] else HAT
    if triangle(x, y, *TIP) or ellipse(x, y, 392, 112, 14, 14):
        return HAT
    # 얼굴 (챙 아래)
    face = ellipse(x, y, 256, 360, 118, 120) and y > 280
    hair = (ellipse(x, y, 140, 360, 50, 132) or ellipse(x, y, 372, 360, 50, 132)) and 280 < y < 470
    if face:
        if ellipse(x, y, 212, 345, 16, 20) or ellipse(x, y, 300, 345, 16, 20):
            return EYE
        if triangle(x, y, (248, 362), (268, 362), (288, 410)):
            return SHADE
        # 씩 웃는 입
        if ellipse(x, y, 256, 420, 52, 22) and not ellipse(x, y, 256, 410, 52, 22) and y > 418:
            return EYE
        return FACE
    if hair:
        return HAIR
    return BG


def render():
    acc = [[[0, 0, 0] for _ in range(SIZE)] for _ in range(SIZE)]
    step = 1.0 / SS
    for sy in range(N):
        y = (sy + 0.5) * step
        row = acc[sy // SS]
        for sx in range(N):
            r, g, b = sample((sx + 0.5) * step, y)
            cell = row[sx // SS]
            cell[0] += r
            cell[1] += g
            cell[2] += b
    div = SS * SS
    return [[[c // div for c in px] for px in row] for row in acc]


def downscale(pixels, target):
    src = len(pixels)
    block = src // target
    out = []
    for ty in range(target):
        row = []
        for tx in range(target):
            r = g = b = 0
            for y in range(ty * block, (ty + 1) * block):
                for x in range(tx * block, (tx + 1) * block):
                    px = pixels[y][x]
                    r += px[0]
                    g += px[1]
                    b += px[2]
            n = block * block
            row.append([r // n, g // n, b // n])
        out.append(row)
    return out


def write_png(path, pixels):
    size = len(pixels)
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for px in row:
            raw += bytes(px)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as handle:
        handle.write(png)


base = render()
out = os.path.join(os.path.dirname(os.path.abspath(__file__)))
write_png(out + '/favicon.png', base)
write_png(out + '/apple-touch-icon.png', downscale(base, 128))
print('favicon 512 / apple-touch-icon 128 생성 완료')
