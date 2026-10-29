"""Original 96 BPM character music and eight synchronized reaction sounds; no TTS."""
from pathlib import Path
import sys, subprocess, math, wave, json
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent.parent/'.work/video-tools'))
import numpy as np
import imageio_ffmpeg
OUT=ROOT/'output';OUT.mkdir(exist_ok=True)
SR=48000;D=80;N=SR*D;TAU=np.pi*2
music=np.zeros((N,2),np.float32);fx=np.zeros_like(music);rng=np.random.default_rng(291026)

def save(path,data):
 with wave.open(str(path),'wb') as f:
  f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes((np.clip(data,-.98,.98)*32767).astype('<i2').tobytes())
def add(track,signal,at,pan=0):
 start=int(at*SR)
 if start>=N:return
 n=min(len(signal),N-start)
 track[start:start+n,0]+=signal[:n]*math.sqrt((1-pan)/2);track[start:start+n,1]+=signal[:n]*math.sqrt((1+pan)/2)
def tone(midi,duration=.5,amp=.1,kind='pluck'):
 t=np.arange(int(SR*duration))/SR;f=440*2**((midi-69)/12)
 if kind=='pad':env=np.minimum(t/.28,1)*np.minimum((duration-t)/.5,1);sig=np.sin(TAU*f*t)+.1*np.sin(TAU*f*2.002*t)
 else:env=np.exp(-t*6/duration)*(1-np.exp(-t*300));sig=np.sin(TAU*f*t)+.20*np.sin(TAU*f*2*t)+.06*np.sin(TAU*f*3*t)
 return sig*env*amp

# Fmaj7 / Am7 / Dm9 / Gsus2, toy piano and soft marimba, rounded bass and handclaps.
chords=[[53,60,64,69],[57,60,64,67],[50,57,60,64],[55,62,67,69]]
beat=.625
for bar in range(32):
 at=bar*2.5;ch=chords[bar%4];energy=.6 if at<4 else 1
 for j,m in enumerate(ch):add(music,tone(m,3,.027*energy,'pad'),at,(j-1.5)*.25)
 for b in [0,2]:add(music,tone(ch[0]-12,.9,.13),at+b*beat)
 for step in range(8):
  m=ch[[0,2,3,1,2,3,2,1][step]]+12
  add(music,tone(m,.65,.050*energy),at+step*beat/2,(-1 if step%2 else 1)*.35)
 if at>=4:
  for b in range(4):
   t=np.arange(int(.18*SR))/SR
   if b%2==0:sig=np.sin(TAU*(51*t+2*(1-np.exp(-t*50))))*np.exp(-t*30)*.14
   else:
    noise=rng.normal(0,1,len(t));sig=np.convolve(noise,np.ones(5)/5,'same')*np.exp(-t*40)*.06
   add(music,sig,at+b*beat)
  for b in range(8):
   t=np.arange(int(.025*SR))/SR;noise=rng.normal(0,1,len(t));sig=np.r_[0,np.diff(noise)]*np.exp(-t*220)*.012
   add(music,sig,at+b*beat/2,.4 if b%2 else -.4)
orders=[[0,1,2,3,4,5,6,7],[0,4,5,3,2,6,1,7],[0,3,2,5,4,6,7,1],[0,6,2,3,5,4,7,1],[0,5,2,3,6,4,1,7],[0,7,5,6,2,4,3,1],[0,2,4,5,6,3,1,7]]
for i,order in enumerate(orders):
 at=4+i*10
 # Soft rising glissando at each character's entrance.
 t=np.arange(int(.35*SR))/SR;add(fx,np.sin(TAU*(400*t+450*t*t))*np.sin(np.pi*t/.35)**2*.035,at,-.4+i*.13)
 for j,mood in enumerate(order):
  when=at+j*1.25+.06;pan=(i-3)*.13
  if mood==0:add(fx,tone(83,.16,.10),when,pan)
  elif mood==1:
   add(fx,tone(81,.35,.11),when,pan);add(fx,tone(88,.35,.08),when+.12,pan)
  elif mood==2:
   for k in range(3):add(fx,tone(76+k*2,.13,.06),when+k*.12,pan)
  elif mood==3:add(fx,tone(89,.55,.065),when,pan)
  elif mood==4:
   t=np.arange(int(.6*SR))/SR;add(fx,np.sin(TAU*(400*t-160*t*t))*np.sin(np.pi*t/.6)**2*.04,when,pan)
  elif mood==5:
   t=np.arange(int(.22*SR))/SR;add(fx,np.sin(TAU*(600*t+1200*t*t))*np.exp(-t*16)*.11,when,pan)
  elif mood==6:
   add(fx,tone(48,.18,.12),when,pan);add(fx,tone(47,.15,.07),when+.10,pan)
  else:
   for k,note in enumerate([84,88,91]):add(fx,tone(note,.3,.07),when+k*.06,pan)
for j,note in enumerate([77,81,84,89]):add(fx,tone(note,1.5,.10),74+j*.18,(j-1.5)*.25)
fade=np.minimum(np.arange(N)/SR/.35,1)*np.minimum((D-np.arange(N)/SR)/1.8,1)
music*=fade[:,None];fx*=fade[:,None];save(OUT/'music.wav',music);save(OUT/'effects.wav',fx);save(OUT/'mix.wav',music+fx)
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
subprocess.run([ffmpeg,'-y','-v','error','-i',str(OUT/'mix.wav'),'-af','loudnorm=I=-16:TP=-1.5:LRA=8','-ar',str(SR),str(OUT/'master.wav')],check=True)
(OUT/'audio-report.json').write_text(json.dumps({'duration':80,'sample_rate':SR,'bpm':96,'music':'Original Fmaj7 / Am7 / Dm9 / Gsus2 toy piano and marimba','reaction_cues':56,'narration':False},indent=2),encoding='utf-8')
print('80-second original music and 56 reaction cues ready.')
