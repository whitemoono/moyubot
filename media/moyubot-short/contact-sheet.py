from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root=Path(__file__).resolve().parent/'output'
times=[2.5,5.8,8.0,11.5,16.5,21.5,27.5]
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',22)
sheet=Image.new('RGB',(4*290+40,2*562+55),'#202940')
draw=ImageDraw.Draw(sheet)
for i,t in enumerate(times):
    im=Image.open(root/'frames'/f'frame-{t:04.1f}.png').convert('RGB')
    im.thumbnail((270,480))
    x=30+i%4*290;y=25+i//4*562
    sheet.paste(im,(x,y));draw.text((x,y+493),f'{t:04.1f}s / 30.0s',font=font,fill='#d4def2')
sheet.save(root/'contact-sheet.jpg',quality=94)
Image.open(root/'frames'/'frame-02.5.png').save(root/'poster.png')
print('Poster and contact sheet complete.')
