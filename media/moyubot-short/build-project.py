"""Build the short film's self-contained browser entry from shared portrait primitives."""
from pathlib import Path

root = Path(__file__).resolve().parent
old = (root.parent / 'moyubot-expressions/film.js').read_text(encoding='utf-8')
prefix = old[:old.index(' function intro(t)')]
prefix = prefix.replace('const geo={};let logo;', 'const geo={};let logo;const images={};let story;')
prefix = prefix.replace('944*t/80', '944*t/30').replace('EXPRESSION STUDIO', 'MEET YOUR AI WORKSPACE').replace('07 BOTS / 08 MOODS', 'PRODUCT FILM / 30 SEC')
body = (root / 'scenes.js').read_text(encoding='utf-8')
init = old[old.index(' async function init()'):]
init = init.replace('window.film={render,bots,moods,orders,canvas,duration:80};', '''
  story=await fetch('story.json').then(r=>r.json());
  await Promise.all(['local','local-terminal','cloud-sleep','memory','tasks'].map(async name=>{
   images[name]=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src='output/ui/'+name+'.png';});
  }));
  window.film={render,bots,canvas,duration:30};''')
init = init.replace('render(6)', 'render(2.5)').replace('Math.min(80,','Math.min(30,').replace('time>=80','time>=30').replace(' / 01:20',' / 00:30')
(root/'film.js').write_text(prefix+body+init,encoding='utf-8')
html=(root.parent/'moyubot-expressions/index.html').read_text(encoding='utf-8')
html=html.replace('七种个性，百种心情','让 AI 上班，你负责摸鱼').replace('EXPRESSION STUDIO','PRODUCT FILM · 30s').replace('七个 Bot 表情展示动画','MoyuBot 新版 30 秒竖屏介绍').replace('max="80"','max="30"').replace(' / 01:20',' / 00:30').replace('MoyuBot-Expressions-Vertical.mp4','MoyuBot-30s-Vertical.mp4')
html=html.replace('height:min(76vh,880px)','height:min(72vh,880px)')
(root/'index.html').write_text(html,encoding='utf-8')
renderer=(root.parent/'moyubot-expressions/render.cjs').read_text(encoding='utf-8')
renderer=renderer.replace('/media/moyubot-expressions/','/media/moyubot-short/').replace('[2.5,5.7,16.7,27.9,36.7,46.7,55.7,66.7,77.5]','[2.5,5.8,8.0,11.5,16.5,21.5,27.5]')
a=renderer.index('  const expressions=[];');b=renderer.index('  if(errors.length)',a)
renderer=renderer[:a]+'''  for(const t of [29.999,0,4,9,14,19,24,3.999,8.999,13.999,18.999,23.999])await page.evaluate(t=>film.render(t),t);
'''+renderer[b:]
renderer=renderer.replace('Portrait QA passed: all seven characters, eight moods and transition/seek checks.','QA passed: six scenes, screenshots, arbitrary seek and transition checks.').replace("'-t','80'","'-t','30'").replace('MoyuBot · 七种个性，百种心情','MoyuBot · 30 秒新版介绍').replace('MoyuBot-Expressions-Vertical.mp4','MoyuBot-30s-Vertical.mp4').replace('f<2400','f<900').replace('/80s','/30s')
(root/'render.cjs').write_text(renderer,encoding='utf-8')
print('Browser project and renderer built.')
