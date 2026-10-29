from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).resolve().parent/'output'
files=sorted((root/'frames').glob('frame-*.png'))
sheet=Image.new('RGB',(1080,((len(files)+2)//3)*672),'#202940');d=ImageDraw.Draw(sheet)
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',18)
for i,file in enumerate(files):
 x=i%3*360;y=i//3*672;sheet.paste(Image.open(file).convert('RGB').resize((360,640),Image.Resampling.LANCZOS),(x,y));d.text((x+12,y+644),file.stem,fill='white',font=font)
sheet.save(root/'storyboard.jpg',quality=94)
files=sorted((root/'frames').glob('mood-*.png'));sheet=Image.new('RGB',(1440,1312),'#202940')
for i,file in enumerate(files):sheet.paste(Image.open(file).convert('RGB').resize((360,640),Image.Resampling.LANCZOS),(i%4*360,i//4*656))
sheet.save(root/'expression-sheet.jpg',quality=95)
Image.open(root/'frames/frame-02.5.png').convert('RGB').save(root/'poster.jpg',quality=96)
print('Portrait poster, storyboard and eight-expression sheet ready.')
