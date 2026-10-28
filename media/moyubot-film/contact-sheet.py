from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent / 'output'
frames = sorted((root / 'frames').glob('*.png'))
sheet = Image.new('RGB', (1920, 384 * ((len(frames) + 2) // 3)), '#111e35')
draw = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 17)
except OSError: font = ImageFont.load_default()
for i, file in enumerate(frames):
    x, y = i % 3 * 640, i // 3 * 384
    sheet.paste(Image.open(file).convert('RGB').resize((640, 360), Image.Resampling.LANCZOS), (x, y))
    draw.text((x + 15, y + 362), file.stem, fill='#bac9df', font=font)
sheet.save(root / 'storyboard-contact-sheet.jpg', quality=94)
Image.open(root / 'frames' / 'frame-015.png').convert('RGB').save(root / 'poster.jpg', quality=96)
print('Contact sheet and poster ready.')
