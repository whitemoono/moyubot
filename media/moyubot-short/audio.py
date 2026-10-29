"""Fresh 30 second arrangement and effects, with Chinese neural narration."""
from pathlib import Path
import importlib.util, json, math, subprocess
import numpy as np

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('shared_audio',ROOT.parent/'moyubot-film/audio.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
a.ROOT=ROOT;a.OUT=ROOT/'output';a.VOICE=a.OUT/'voice';a.VOICE.mkdir(exist_ok=True)
a.STORY=json.loads((ROOT/'story.json').read_text(encoding='utf-8'));a.DURATION=30
SR=a.SR;N=SR*30;TAU=np.pi*2

def music_and_fx():
    music=np.zeros((N,2),np.float32);fx=np.zeros_like(music);rng=np.random.default_rng(4318)
    def add(track,at,signal,pan=0):
        st=int(at*SR);n=min(len(signal),N-st)
        if n<=0 or st<0:return
        track[st:st+n,0]+=signal[:n]*math.sqrt((1-pan)/2)
        track[st:st+n,1]+=signal[:n]*math.sqrt((1+pan)/2)
    def note(midi,dur,amp=.06,pad=False):
        t=np.arange(int(dur*SR))/SR;f=440*2**((midi-69)/12)
        env=np.minimum(t/.3,1)*np.minimum((dur-t)/.7,1) if pad else np.exp(-t*7)*(1-np.exp(-t*200))
        return (np.sin(TAU*f*t)+.19*np.sin(TAU*f*2.001*t))*env*amp
    # 120 BPM; ten 3-second harmonic phrases. Five-second scene cuts get soft sweeps.
    chords=[[50,57,61,66],[47,54,57,62],[43,50,54,59],[45,52,57,61]]
    for bar in range(15):
        at=bar*2;chord=chords[bar%4]
        for j,midi in enumerate(chord):add(music,at,note(midi,2.7,.022,True),(j-1.5)*.35)
        for step in range(8):add(music,at+step*.25,note(chord[[1,2,3,2,0,2,3,1][step]]+12,.8,.045),(-1 if step%2 else 1)*.4)
        for beat in range(4):
            t=np.arange(int(.23*SR))/SR;kick=np.sin(TAU*(48*t+2*(1-np.exp(-t*45))))*np.exp(-t*28)*.13
            if beat%2==0:add(music,at+beat*.5,kick)
            else:
                t=np.arange(int(.09*SR))/SR;noise=rng.normal(0,1,len(t));add(music,at+beat*.5,np.r_[0,np.diff(noise)]*np.exp(-t*65)*.018,.2)
        add(music,at,note(chord[0]-12,1.6,.13))
    fade=np.minimum(np.arange(N)/SR/.35,1)*np.minimum((30-np.arange(N)/SR)/1.1,1);music*=fade[:,None]
    for at in [4,9,14,19,24]:
        t=np.arange(int(.34*SR))/SR;noise=rng.normal(0,1,len(t));noise=np.convolve(noise,np.ones(32)/32,mode='same')
        add(fx,at-.06,noise*np.sin(np.pi*t/.34)**2*.23,-.2)
    for i in range(7):add(fx,.2+i*.12,note(74+i, .5,.045),(i-3)/5)
    for at in [6.5,10,14.6,15.2,19.3,19.6,20,20.4]:add(fx,at,note(81,.4,.065),.15)
    for i,midi in enumerate([74,78,81]):add(fx,24.1+i*.14,note(midi,1,.09),(i-1)*.3)
    return music,fx

if __name__=='__main__':
    voice,mode,report=a.narrative();music,fx=music_and_fx();duck=np.ones(N,np.float32)
    for cue in a.STORY['cues']:
        start=max(0,int((cue['start']-.1)*SR));end=min(N,int((cue['end']+.1)*SR));duck[start:end]=.5
    a.write_wav(a.OUT/'music.wav',music);a.write_wav(a.OUT/'effects.wav',fx)
    a.write_wav(a.OUT/'mix.wav',voice[:,None]*.90+music*duck[:,None]+fx)
    subprocess.run([a.FFMPEG,'-y','-v','error','-i',str(a.OUT/'mix.wav'),'-af','loudnorm=I=-16:TP=-1.5:LRA=8','-ar',str(SR),'-ac','2',str(a.OUT/'master.wav')],check=True)
    srt='\n\n'.join(f'{i+1}\n{a.srt_time(q["start"])} --> {a.srt_time(q["end"])}\n{q["text"]}' for i,q in enumerate(a.STORY['cues']))+'\n'
    (a.OUT/'MoyuBot.zh-CN.srt').write_text(srt,encoding='utf-8-sig')
    (a.OUT/'audio-report.json').write_text(json.dumps({'voice':mode,'music':'Original procedural composition · 120 BPM · D major','sample_rate':SR,'cues':report},ensure_ascii=False,indent=2),encoding='utf-8')
    print('30-second narration, score, effects and stereo master complete.')
