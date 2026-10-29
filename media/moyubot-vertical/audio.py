"""90 second Chinese voice, original procedural score and timed UI effects."""
from pathlib import Path
import importlib.util, json, math, subprocess
import numpy as np
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('shared_audio',ROOT.parent/'moyubot-film/audio.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
a.ROOT=ROOT;a.OUT=ROOT/'output';a.VOICE=a.OUT/'voice';a.VOICE.mkdir(parents=True,exist_ok=True)
a.STORY=json.loads((ROOT/'story.json').read_text(encoding='utf-8'));a.DURATION=90
SR=a.SR

def effects():
    fx=np.zeros((90*SR,2),np.float32);rng=np.random.default_rng(4318)
    def add(at,signal,pan=0):
        start=int(at*SR);n=min(len(signal),len(fx)-start)
        if n>0:fx[start:start+n,0]+=signal[:n]*math.sqrt((1-pan)/2);fx[start:start+n,1]+=signal[:n]*math.sqrt((1+pan)/2)
    def ping(at,freq=740,amp=.06):
        tt=np.arange(int(.2*SR))/SR;add(at,np.sin(2*np.pi*freq*tt)*np.exp(-tt*25)*(1-np.exp(-tt*240))*amp)
    for scene in a.STORY['scenes'][1:]:
        tt=np.arange(int(.35*SR))/SR;noise=rng.normal(0,1,len(tt));noise=np.convolve(noise,np.ones(32)/32,mode='same');add(scene['start'],noise*np.sin(np.pi*tt/.35)**2*.13,-.25)
    for i in range(7):ping(5.4+i*.1,560*2**(i/12),.035)
    for at in [20.2,22.7,24.2,25.5,37.6,40.5,43.4,44.5,45.5,49.3,50.7,52,55.4,62.8,67.3,68.8]:ping(at,760,.045)
    for at in [33,45.6,55.5,63.1]:ping(at,660);ping(at+.15,990,.04)
    for start in [27.5,57.4,58.7,60.2,61.9]:
        for j in range(7):ping(start+j*.07,1400+j*36,.01)
    for i,note in enumerate([74,78,81]):ping(84.3+i*.2,440*2**((note-69)/12),.06)
    a.write_wav(a.OUT/'effects.wav',fx);return fx

if __name__=='__main__':
    voice,mode,report=a.narrative();music=a.score();fx=effects()
    duck=np.ones(len(voice),np.float32)
    for q in a.STORY['cues']:
        start=max(0,int((q['start']-.12)*SR));end=min(len(voice),int((q['end']+.12)*SR));r=min(int(.12*SR),(end-start)//2)
        env=np.full(end-start,.48,np.float32);env[:r]=np.linspace(1,.48,r);env[-r:]=np.linspace(.48,1,r);duck[start:end]=np.minimum(duck[start:end],env)
    a.write_wav(a.OUT/'mix.wav',music*duck[:,None]+fx+voice[:,None]*.88)
    subprocess.run([a.FFMPEG,'-y','-v','error','-i',str(a.OUT/'mix.wav'),'-af','loudnorm=I=-16:TP=-1.5:LRA=8','-ar',str(SR),'-ac','2',str(a.OUT/'master.wav')],check=True)
    srt='\n\n'.join(f'{i+1}\n{a.srt_time(q["start"])} --> {a.srt_time(q["end"])}\n{q.get("subtitle",q["text"])}' for i,q in enumerate(a.STORY['cues']))+'\n'
    (a.OUT/'MoyuBot.zh-CN.srt').write_text(srt,encoding='utf-8-sig')
    (a.OUT/'audio-report.json').write_text(json.dumps({'voice':mode,'sample_rate':SR,'music':'Original procedural composition, 100 BPM','cues':report},ensure_ascii=False,indent=2),encoding='utf-8')
    print('Audio master ready',flush=True)
