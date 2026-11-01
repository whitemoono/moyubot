import React from 'react';
import {AbsoluteFill, Sequence} from 'remotion';
import {Caption} from './components/ui';
import {AgentLoop} from './scenes/AgentLoop';
import {Brand} from './scenes/Brand';
import {BotsShowcase} from './scenes/BotsShowcase';
import {CloudWake} from './scenes/CloudWake';
import {GroupScene} from './scenes/GroupScene';
import {Hook} from './scenes/Hook';
import {MemoryScene} from './scenes/MemoryScene';
import {Outro} from './scenes/Outro';
import {Workspace} from './scenes/Workspace';
import {Mixdown} from './Mixdown';
import {STORY, sceneFrames} from './story';

const SCENES: {id: string; comp: React.FC}[] = [
  {id: 'hook', comp: Hook},
  {id: 'brand', comp: Brand},
  {id: 'workspace', comp: Workspace},
  {id: 'agent', comp: AgentLoop},
  {id: 'cloud', comp: CloudWake},
  {id: 'bots', comp: BotsShowcase},
  {id: 'group', comp: GroupScene},
  {id: 'memory', comp: MemoryScene},
  {id: 'outro', comp: Outro},
];

export const MoyuBotIntro: React.FC = () => {
  return (
    <AbsoluteFill style={{backgroundColor: '#05070f', fontFamily: 'sans-serif'}}>
      {SCENES.map(({id, comp: Comp}) => {
        const f = sceneFrames(id);
        return (
          <Sequence key={id} from={f.from} durationInFrames={f.durationInFrames} name={id}>
            <Comp />
          </Sequence>
        );
      })}
      <Caption />
      <Mixdown />
    </AbsoluteFill>
  );
};

export const INTRO_META = {
  id: 'MoyuBotIntro',
  title: STORY.meta.title,
  durationInFrames: Math.round(STORY.scenes[STORY.scenes.length - 1].end * STORY.meta.fps),
  fps: STORY.meta.fps,
  width: STORY.meta.width,
  height: STORY.meta.height,
};
