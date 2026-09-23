"""BASAK WITCH 파비콘 생성 — 메뉴판 팔레트의 잭오랜턴. 외부 라이브러리 없이 PNG를 직접 씁니다."""
import os, struct, zlib

BG = (0x14, 0x11, 0x0F)       # 차콜 나이트
ORANGE = (0xF2, 0x91, 0x1E)   # 펌킨 오렌지
DEEP = (0xC9, 0x6F, 0x0C)     # 능선 그림자
GREEN = (0x4F, 0x8C, 0x25)    # 꼭지

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


BODY = [
    (256, 300, 122, 156),
    (196, 300, 96, 149),
    (316, 300, 96, 149),
    (147, 300, 69, 129),
    (365, 300, 69, 129),
]
RIDGES = [(196, 300, 96, 149), (316, 300, 96, 149)]

EYE_L = ((168, 248), (234, 248), (201, 318))
EYE_R = ((278, 248), (344, 248), (311, 318))
NOSE = ((240, 352), (272, 352), (256, 312))

MOUTH_X0, MOUTH_X1 = 158, 354
TOP_TEETH = (190, 256, 322)
BOTTOM_TEETH = (223, 289)


def mouth_top(x):
    return 386.0 - 0.0035 * (x - 256) ** 2


def in_mouth(x, y):
    if not (MOUTH_X0 <= x <= MOUTH_X1):
        return False
    top = mouth_top(x)
    if not (top <= y <= top + 46):
        return False
    for c in TOP_TEETH:                       # 위쪽 이
        if triangle(x, y, (c - 25, top - 1), (c + 25, top - 1), (c, top + 31)):
            return False
    for c in BOTTOM_TEETH:                    # 아래쪽 이
        bot = top + 47
        if triangle(x, y, (c - 23, bot), (c + 23, bot), (c, top + 16)):
            return False
    return True


def sample(x, y):
    """SIZE 좌표계의 한 점 색을 돌려줍니다."""
    # 꼭지와 잎
    if ellipse(x, y, 256, 150, 20, 46) or ellipse(x, y, 300, 158, 44, 15):
        return GREEN
    body = any(ellipse(x, y, cx, cy, rx, ry) for cx, cy, rx, ry in BODY)
    if not body:
        return BG
    if triangle(x, y, *EYE_L) or triangle(x, y, *EYE_R) or triangle(x, y, *NOSE):
        return BG
    if in_mouth(x, y):
        return BG
    # 호박 능선: 큰 곡면 두 개의 테두리만 살짝 어둡게
    for cx, cy, rx, ry in RIDGES:
        d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
        if 0.955 <= d <= 1.0:
            return DEEP
    return ORANGE


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
