"""Chinese narration, original score, sound design, stereo master and SRT."""
from pathlib import Path
import asyncio, json, math, subprocess, sys, wave
ROOT = Path(__file__).resolve().parent
LOCAL_TOOLS = ROOT.parent.parent / '.work' / 'video-tools'
if LOCAL_TOOLS.exists(): sys.path.insert(0, str(LOCAL_TOOLS))
import numpy as np
import imageio_ffmpeg
OUT = ROOT / 'output'
VOICE = OUT / 'voice'
OUT.mkdir(exist_ok=True)
VOICE.mkdir(exist_ok=True)
STORY = json.loads((ROOT / 'story.json').read_text(encoding='utf-8'))
SR = 48000
DURATION = STORY['duration']
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
TAU=2*np.pi

def write_wav(path, data):
    with wave.open(str(path), 'wb') as f:
        f.setnchannels(data.shape[1] if data.ndim > 1 else 1)
        f.setsampwidth(2); f.setframerate(SR)
        f.writeframes((np.clip(data, -.995, .995) * 32767).astype('<i2').tobytes())

async def neural_voice():
    import edge_tts
    async def one(i, cue):
        target = VOICE / f'voice-{i:02d}.mp3'
        if target.exists() and target.stat().st_size > 1000: return
        communicate = edge_tts.Communicate(cue['text'], 'zh-CN-XiaoxiaoNeural', rate='+3%')
        await asyncio.wait_for(communicate.save(str(target)), 28)
        print(f'Neural narration {i+1}/{len(STORY["cues"])}', flush=True)
    await one(0, STORY['cues'][0])
    for i in range(1, len(STORY['cues']), 3):
        await asyncio.gather(*(one(j, STORY['cues'][j]) for j in range(i, min(i+3, len(STORY['cues'])))))

def load_pcm(path, speed=1):
    cmd=[FFMPEG,'-v','error','-i',str(path)]
    if speed != 1: cmd += ['-af',f'atempo={speed:.6f}']
    cmd += ['-f','f32le','-ac','1','-ar',str(SR),'-']
    return np.frombuffer(subprocess.check_output(cmd), dtype='<f4').copy()

def narrative():
    mode='Microsoft Xiaoxiao Neural'
    if '--offline' not in sys.argv:
        try: asyncio.run(neural_voice())
        except Exception as error:
            print(f'Neural service unavailable ({type(error).__name__}); using installed Chinese voice.',flush=True)
            mode='Microsoft Huihui Desktop (offline synthesis)'
    else: mode='Microsoft Huihui Desktop (offline synthesis)'
    offline='offline' in mode
    if offline:
        subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'synthesize.ps1')],check=True)
    track=np.zeros(int(DURATION*SR),dtype=np.float32); report=[]
    for i,cue in enumerate(STORY['cues']):
        source=VOICE/f'voice-{i:02d}{".wav" if offline else ".mp3"}'
        pcm=load_pcm(source)
        audible=np.flatnonzero(np.abs(pcm)>.009)
        if len(audible): pcm=pcm[max(0,audible[0]-int(.045*SR)):min(len(pcm),audible[-1]+int(.12*SR))]
        window=cue['end']-cue['start']-.10
        speed=max(1.,len(pcm)/SR/window)
        if speed>1:
            temp=VOICE/f'trim-{i:02d}.wav'; write_wav(temp,pcm); pcm=load_pcm(temp,speed)
        peak=max(.001,float(np.max(np.abs(pcm)))); pcm*=.68/peak
        n=min(240,len(pcm)//2);pcm[:n]*=np.linspace(0,1,n);pcm[-n:]*=np.linspace(1,0,n)
        start=int(cue['start']*SR);end=min(len(track),start+len(pcm));track[start:end]+=pcm[:end-start]
        report.append({'cue':i+1,'start':cue['start'],'spoken_duration':round(len(pcm)/SR,3),'available':round(window,3),'speed':round(speed,3)})
    write_wav(OUT/'narration.wav',track)
    return track, mode, report

def score():
    n=int(DURATION*SR); music=np.zeros((n,2),dtype=np.float32);rng=np.random.default_rng(20261029);beat=.6
    chords=[[50,57,61,66,69],[47,54,57,62,66],[43,50,54,57,62],[45,52,57,59,64]]
    def add(buf,at,pan=0):
        st=int(at*SR)
        if st<0 or st>=n:return
        sz=min(len(buf),n-st);music[st:st+sz,0]+=buf[:sz]*math.sqrt((1-pan)/2);music[st:st+sz,1]+=buf[:sz]*math.sqrt((1+pan)/2)
    def note(midi,dur,amp=.08,kind='pluck'):
        tt=np.arange(int(dur*SR),dtype=np.float32)/SR;f=440*2**((midi-69)/12)
        if kind=='pad':
            env=np.minimum(tt/.7,1)*np.minimum((dur-tt)/1.,1)
            return (np.sin(TAU*f*tt)+.16*np.sin(TAU*f*2.003*tt))*env*amp
        env=np.exp(-tt*5/max(.25,dur))*(1-np.exp(-tt*180))
        return (np.sin(TAU*f*tt)+.25*np.sin(TAU*f*2*tt)+.08*np.sin(TAU*f*3*tt))*env*amp
    for bar in range(math.ceil(DURATION/(beat*4))):
        at=bar*beat*4;chord=chords[bar%4]
        energy=.6 if at<8 else 1.0 if at<56 else .7 if at<68 else .95 if at<80 else .65
        for j,midi in enumerate(chord):add(note(midi,3.5,.021*energy,'pad'),at,(j-2)*.25)
        add(note(chord[0]-12,2.3,.075*energy),at,0)
        for step in range(8):
            midi=chord[[2,3,4,3,1,3,4,2][step]]+12
            add(note(midi,.9,.033*energy),at+step*beat/2,(-1 if step%2 else 1)*.35)
        if 19<at<80:
            for b in range(4):
                tt=np.arange(int(.22*SR))/SR
                kick=np.sin(TAU*(49*tt+3.3*(1-np.exp(-tt*45))))*np.exp(-tt*23)*.10
                if b%2==0:add(kick,at+b*beat)
                else:
                    noise=rng.normal(0,1,int(.09*SR)).astype(np.float32)
                    noise=np.r_[0,np.diff(noise)]*np.exp(-np.arange(len(noise))/SR*70)*.025
                    add(noise,at+b*beat,.15)
            for step in range(8):
                h=rng.normal(0,1,int(.035*SR)).astype(np.float32);h=np.r_[0,np.diff(h)]*np.exp(-np.arange(len(h))/SR*170)*.011
                add(h,at+step*beat/2,.35 if step%2 else -.35)
    for at in [.3,100.2]:
        for j,midi in enumerate([74,78,81]):add(note(midi,2,.075),at+j*.22,(j-1)*.3)
    fade=np.minimum(np.arange(n)/SR/2,1)*np.minimum((DURATION-np.arange(n)/SR)/2.5,1);music*=fade[:,None]
    write_wav(OUT/'music.wav',music);return music

def effects():
    fx=np.zeros((int(DURATION*SR),2),dtype=np.float32);rng=np.random.default_rng(7)
    def place(at,buf,pan=0):
        st=int(at*SR);sz=min(len(buf),len(fx)-st)
        fx[st:st+sz,0]+=buf[:sz]*math.sqrt((1-pan)/2);fx[st:st+sz,1]+=buf[:sz]*math.sqrt((1+pan)/2)
    def ping(at,freq=800,pan=0,amp=.09):
        tt=np.arange(int(.22*SR))/SR;place(at,np.sin(TAU*freq*tt)*np.exp(-tt*24)*(1-np.exp(-tt*250))*amp,pan)
    for scene in STORY['scenes'][1:]:
        tt=np.arange(int(.45*SR))/SR;noise=rng.normal(0,1,len(tt));noise=np.convolve(noise,np.ones(24)/24,mode='same')
        place(scene['start'],noise*np.sin(np.pi*tt/.45)**2*.18,-.3)
    for i in range(7):ping(8.7+i*.24,560*2**(i/12),(i-3)/4,.065)
    for at in [35,37,41,73.6]:ping(at,660);ping(at+.12,880,0,.06)
    for i in range(6):
        for j in range(3):ping(45.4+i*.85+j*.07,1300+j*50,.3,.018)
    for i in range(4):ping(80.75+i*.55,500+i*80,-.4+i*.25,.045)
    write_wav(OUT/'effects.wav',fx);return fx

def srt_time(t):
    ms=round(t*1000);return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'

if __name__=='__main__':
    voice,mode,report=narrative();music=score();fx=effects()
    duck=np.ones(len(voice),dtype=np.float32)
    for cue in STORY['cues']:
        a=max(0,int((cue['start']-.15)*SR));b=min(len(duck),int((cue['end']+.2)*SR))
        r=min(int(.16*SR),(b-a)//2);env=np.ones(b-a,dtype=np.float32)*.54
        env[:r]=np.linspace(1,.54,r);env[-r:]=np.linspace(.54,1,r);duck[a:b]=np.minimum(duck[a:b],env)
    mixed=music*duck[:,None]+fx+voice[:,None]*.88;write_wav(OUT/'mix.wav',mixed)
    subprocess.run([FFMPEG,'-y','-v','error','-i',str(OUT/'mix.wav'),'-af','loudnorm=I=-16:TP=-1.5:LRA=8','-ar',str(SR),'-ac','2',str(OUT/'master.wav')],check=True)
    srt='\n\n'.join(f'{i+1}\n{srt_time(q["start"])} --> {srt_time(q["end"])}\n{q["text"]}' for i,q in enumerate(STORY['cues']))+'\n'
    (OUT/'MoyuBot.zh-CN.srt').write_text(srt,encoding='utf-8-sig')
    (OUT/'audio-report.json').write_text(json.dumps({'voice':mode,'sample_rate':SR,'music':'Original procedural composition, 100 BPM, D major','cues':report},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'Audio ready: {mode}',flush=True)
