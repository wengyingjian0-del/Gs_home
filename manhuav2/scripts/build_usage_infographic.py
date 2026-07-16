from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(r"D:\AIcoding\manhua demo")
SHOT = ROOT / "docs" / "screenshots"
OUT = ROOT / "docs" / "漫小星_V2_图文使用说明长图.png"

W, H = 1080, 7280
BG = "#FFF9EF"
INK = "#2D2926"
MUTED = "#776E67"
CORAL = "#FF7B82"
CORAL_DARK = "#C94E5B"
GREEN = "#77B956"
GREEN_DARK = "#477C3A"
PALE_PINK = "#FFF0EC"
PALE_GREEN = "#F0F8E8"
PALE_BLUE = "#EDF7FB"
PALE_GOLD = "#FFF5D9"
WHITE = "#FFFFFF"
RED_BG = "#FFF0ED"
RED = "#B84E4E"

FONT_CN = r"C:\Windows\Fonts\Deng.ttf"
FONT_CN_B = r"C:\Windows\Fonts\Dengb.ttf"
FONT_NUM = r"C:\Users\59518\.agents\skills\canvas-design\canvas-fonts\BigShoulders-Bold.ttf"

def font(size, bold=False, numeric=False):
    return ImageFont.truetype(FONT_NUM if numeric else (FONT_CN_B if bold else FONT_CN), size)

def rounded(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

def shadow_card(canvas, box, radius=32, fill=WHITE, outline="#F2D8D0"):
    x0, y0, x1, y1 = box
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle((x0+8, y0+14, x1+8, y1+14), radius=radius, fill=(88, 55, 40, 26))
    layer = layer.filter(ImageFilter.GaussianBlur(12))
    canvas.alpha_composite(layer)
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=2)

def text_wrap(draw, text, fnt, max_width):
    lines, current = [], ""
    closing = "，。；：！？、”’）】》」』"
    opening = "“‘（【《「『"
    for ch in text:
        trial = current + ch
        if draw.textbbox((0, 0), trial, font=fnt)[2] <= max_width:
            current = trial
        else:
            # Keep Chinese closing punctuation with the preceding line.
            if ch in closing and current:
                lines.append(current + ch)
                current = ""
                continue
            # Do not leave an opening quote/bracket at the end of a line.
            carry = ""
            if current and current[-1] in opening:
                carry = current[-1]
                current = current[:-1]
            if current:
                lines.append(current)
            current = carry + ch
    if current:
        lines.append(current)
    return lines

def draw_wrapped(draw, xy, text, fnt, fill, max_width, spacing=12, max_lines=None):
    x, y = xy
    lines = text_wrap(draw, text, fnt, max_width)
    if max_lines:
        lines = lines[:max_lines]
    line_h = fnt.size + spacing
    for i, line in enumerate(lines):
        draw.text((x, y+i*line_h), line, font=fnt, fill=fill)
    return y + len(lines)*line_h

def paste_rounded(canvas, source_path, box, radius=28, crop=None):
    src = Image.open(source_path).convert("RGB")
    if crop:
        src = src.crop(crop)
    x0, y0, x1, y1 = map(int, box)
    max_w, max_h = x1-x0, y1-y0
    ratio = min(max_w/src.width, max_h/src.height)
    size = (max(1, int(src.width*ratio)), max(1, int(src.height*ratio)))
    src = src.resize(size, Image.Resampling.LANCZOS)
    px = x0 + (max_w-size[0])//2
    py = y0 + (max_h-size[1])//2
    mask = Image.new("L", size, 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle((0, 0, size[0]-1, size[1]-1), radius=radius, fill=255)
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((px+8, py+12, px+size[0]+8, py+size[1]+12), radius=radius, fill=(70, 45, 35, 32))
    shadow = shadow.filter(ImageFilter.GaussianBlur(12))
    canvas.alpha_composite(shadow)
    canvas.paste(src.convert("RGBA"), (px, py), mask)
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((px-1, py-1, px+size[0], py+size[1]), radius=radius, outline="#EABEB8", width=3)
    return (px, py, px+size[0], py+size[1])

def pill(draw, xy, label, fill, color, fnt=None, pad_x=20, pad_y=10):
    fnt = fnt or font(24, True)
    x, y = xy
    b = draw.textbbox((0,0), label, font=fnt)
    w, h = b[2]-b[0]+pad_x*2, b[3]-b[1]+pad_y*2
    rounded(draw, (x, y, x+w, y+h), h//2, fill)
    draw.text((x+pad_x, y+pad_y-2), label, font=fnt, fill=color)
    return w, h

def step_block(canvas, y, number, title, body, note, image_name, image_left=False, accent=CORAL):
    d = ImageDraw.Draw(canvas)
    x0, x1, h = 48, 1032, 850
    fill = WHITE if number % 2 else "#FFFDF8"
    shadow_card(canvas, (x0, y, x1, y+h), 38, fill, "#EFD9D2")
    img_box = (80, y+55, 478, y+795) if image_left else (602, y+55, 1000, y+795)
    paste_rounded(canvas, SHOT/image_name, img_box, 26)
    tx = 540 if image_left else 82
    tw = 430
    # number badge
    d.ellipse((tx, y+76, tx+84, y+160), fill=accent)
    num_f = font(50, numeric=True)
    nb = d.textbbox((0,0), f"{number:02d}", font=num_f)
    d.text((tx+42-(nb[2]-nb[0])/2, y+82), f"{number:02d}", font=num_f, fill=WHITE)
    d.text((tx, y+190), title, font=font(45, True), fill=INK)
    yy = draw_wrapped(d, (tx, y+270), body, font(29), INK, tw, 15)
    rounded(d, (tx, yy+28, tx+tw, yy+150), 22, PALE_GREEN if accent==GREEN else PALE_PINK)
    d.text((tx+18, yy+45), "完成标志", font=font(22, True), fill=GREEN_DARK if accent==GREEN else CORAL_DARK)
    draw_wrapped(d, (tx+18, yy+82), note, font(25), INK, tw-36, 10, 2)
    # micro label under screenshot
    label_x = img_box[0]+16
    d.text((label_x, y+800), "真实产品页面", font=font(18, True), fill=MUTED)
    return y+h

canvas = Image.new("RGBA", (W, H), BG)
d = ImageDraw.Draw(canvas)

# Header background gradient
for y in range(0, 700):
    t = y/700
    c1 = (255, 239, 235)
    c2 = (255, 249, 239)
    col = tuple(int(c1[i]*(1-t)+c2[i]*t) for i in range(3)) + (255,)
    d.line((0, y, W, y), fill=col)

pill(d, (60, 58), "V2 · 图文使用说明", WHITE, CORAL_DARK, font(23, True))
d.text((58, 135), "漫小星", font=font(88, True), fill=INK)
d.text((58, 245), "把一句话，变成属于你的漫画", font=font(43, True), fill=CORAL_DARK)
d.text((60, 320), "适合儿童创作、家长陪伴，也适用于业务与运营演示", font=font(28), fill=MUTED)

# Hero pathway
path_y = 405
labels = [("选主角", "01"), ("讲故事", "02"), ("等生成", "03"), ("继续改", "04"), ("保存作品", "05")]
for i, (lab, num) in enumerate(labels):
    x = 60 + i*200
    d.ellipse((x, path_y, x+54, path_y+54), fill=CORAL if i < 4 else GREEN)
    d.text((x+13, path_y+9), num, font=font(24, numeric=True), fill=WHITE)
    d.text((x, path_y+68), lab, font=font(24, True), fill=INK)
    if i < len(labels)-1:
        d.line((x+62, path_y+27, x+184, path_y+27), fill="#E7AAA7", width=4)
        d.polygon([(x+184,path_y+27),(x+170,path_y+18),(x+170,path_y+36)], fill="#E7AAA7")

# Prep card
prep_y = 575
shadow_card(canvas, (48, prep_y, 1032, 1005), 36, WHITE, "#EEDFD7")
d.text((78, prep_y+36), "开始前，先准备 3 件事", font=font(37, True), fill=INK)
prep_items = [("1", "想画谁", "人物、机器人、动物或原创角色"), ("2", "在哪里", "森林、校园、海边、梦境等"), ("3", "做什么", "寻找宝藏、观察昆虫、奔跑等")]
for i,(n,t,s) in enumerate(prep_items):
    x = 78+i*310
    rounded(d,(x,prep_y+105,x+280,prep_y+225),24,[PALE_PINK,PALE_GREEN,PALE_BLUE][i])
    d.text((x+18,prep_y+120),n,font=font(32,numeric=True),fill=CORAL_DARK)
    d.text((x+66,prep_y+117),t,font=font(28,True),fill=INK)
    draw_wrapped(d,(x+18,prep_y+162),s,font(20),MUTED,245,6,2)
pill(d,(78,prep_y+265),"当前不支持本地图片或真人照片上传",RED_BG,RED,font(22,True))
d.text((78, prep_y+330), "请勿填写真实姓名、手机号、学校或住址。重要作品请及时下载。", font=font(24), fill=MUTED)

y = 1045
y = step_block(canvas, y, 1, "创建并保存主角",
               "点击首页“开始创建”，选择主角类型、性格和画风；最后补充外观、起名字，点击“保存主角”。",
               "角色卡显示“当前主角”。", "02-创建角色.png", image_left=False, accent=CORAL)
y += 36
y = step_block(canvas, y, 2, "选择场景和故事",
               "点击“用这个主角创作”，选择地点、动作、心情、额外元素和天气。最后点击“生成漫画”。",
               "页面进入“你的故事正在变成漫画”。", "04-选择场景.png", image_left=True, accent=GREEN)
y += 36
y = step_block(canvas, y, 3, "等待系统绘制",
               "看到生成页面后保持当前页面。系统会在后台绘制两张初稿，并自动选择、继续优化。",
               "成功后自动进入“对话改图”。", "06-生成中.png", image_left=False, accent=CORAL)
y += 36
y = step_block(canvas, y, 4, "查看结果并继续修改",
               "输入“换成雨天”“让主角开心一点”等要求，再点击“发送”。建议一次只修改一个方面。",
               "图片下方显示“✓ 当前参考版本”。", "07-生成成功与对话改图.png", image_left=True, accent=GREEN)
y += 36
y = step_block(canvas, y, 5, "打开作品历史",
               "点击右上角“历史”或底部“作品集”。点图片可打开完整结果；点“引用这张图继续修改”可回到改图。",
               "作品集显示“最新版本”和生成时间。", "08-作品集.png", image_left=False, accent=CORAL)
y += 36

# Step 6 custom: result screenshot + small settings inset
step_y = y
shadow_card(canvas, (48, step_y, 1032, step_y+850), 38, "#FFFDF8", "#EFD9D2")
paste_rounded(canvas, SHOT/"09-生成结果.png", (80, step_y+55, 478, step_y+795), 26)
tx = 540
d.ellipse((tx, step_y+76, tx+84, step_y+160), fill=GREEN)
num_f=font(50,numeric=True); nb=d.textbbox((0,0),"06",font=num_f)
d.text((tx+42-(nb[2]-nb[0])/2,step_y+82),"06",font=num_f,fill=WHITE)
d.text((tx, step_y+190), "下载作品", font=font(45, True), fill=INK)
yy = draw_wrapped(d,(tx,step_y+270),"先到“设置”开启“允许下载作品”；再从作品集打开图片，在结果页点击“下载”。",font(29),INK,430,15)
rounded(d,(tx,yy+28,970,yy+150),22,PALE_GREEN)
d.text((tx+18,yy+45),"完成标志",font=font(22,True),fill=GREEN_DARK)
d.text((tx+18,yy+84),"浏览器开始下载 PNG。",font=font(25),fill=INK)
# settings inset, cropped to toggle region
paste_rounded(canvas, SHOT/"10-下载设置.png", (540, step_y+560, 970, step_y+790), 20, crop=(0,340,430,670))
d.text((96,step_y+800),"真实结果页",font=font(18,True),fill=MUTED)
d.text((556,step_y+802),"设置 → 允许下载作品",font=font(18,True),fill=MUTED)
y = step_y+850+36

# More feature strip
rounded(d,(48,y,1032,y+170),30,PALE_GREEN,outline="#CDE7BB",width=2)
d.text((78,y+28),"还想做四格漫画？",font=font(31,True),fill=GREEN_DARK)
d.text((78,y+82),"首页 → 四格漫画工作室 → 选择主角和故事类型 → “AI帮我写四格故事”",font=font(25),fill=INK)
d.text((78,y+125),"四格需要依次生成 4 张图片，等待时间会比单幅漫画更长。",font=font(21),fill=MUTED)
y += 206

# FAQ section
d.text((52,y),"遇到问题怎么办？",font=font(46,True),fill=INK)
d.text((54,y+62),"先看页面提示，再选择修改、等待或重新生成。",font=font(25),fill=MUTED)
faq_y=y+120
shadow_card(canvas,(48,faq_y,1032,faq_y+520),34,WHITE,"#EFD9D2")
faqs=[
    ("生成失败", "出现“重新生成”时可点击重试；连续失败先简化描述。"),
    ("等待较久", "单次最长约 3 分钟，不要刷新或反复点击。"),
    ("图片不合要求", "一次只改一个方面，或从作品集引用更合适的版本。"),
    ("内容被阻止", "删除真实个人信息、危险内容或真实公众人物要求。"),
]
for i,(q,a) in enumerate(faqs):
    row_y=faq_y+30+i*112
    d.ellipse((78,row_y+4,116,row_y+42),fill=CORAL if i!=1 else "#E6B54A")
    d.text((91,row_y+6),"!" if i!=1 else "…",font=font(23,True),fill=WHITE)
    d.text((135,row_y),q,font=font(27,True),fill=INK)
    draw_wrapped(d,(135,row_y+42),a,font(22),MUTED,520,7,2)
# actual error crop on right bottom
paste_rounded(canvas,SHOT/"12-隐私信息提示.png",(700,faq_y+50,990,faq_y+455),18,crop=(0,455,430,760))

# Footer
footer_y=H-115
d.line((48,footer_y-24,1032,footer_y-24),fill="#E8D8D0",width=2)
d.text((50,footer_y),"漫小星 V2 · 当前为内部测试版",font=font(21,True),fill=MUTED)
d.text((760,footer_y),"真实页面截图 · 2026.07",font=font(20),fill=MUTED)

canvas.convert("RGB").save(OUT, quality=96, optimize=True)
print(OUT)
