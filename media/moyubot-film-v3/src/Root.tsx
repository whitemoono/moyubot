import React from 'react';
import {Composition, Folder} from 'remotion';
import {INTRO_META, MoyuBotIntro} from './MoyuBotIntro';
import {AgentLoop} from './scenes/AgentLoop';
import {Brand} from './scenes/Brand';
import {BotsShowcase} from './scenes/BotsShowcase';
import {CloudWake} from './scenes/CloudWake';
import {GroupScene} from './scenes/GroupScene';
import {Hook} from './scenes/Hook';
import {MemoryScene} from './scenes/MemoryScene';
import {Outro} from './scenes/Outro';
import {Workspace} from './scenes/Workspace';
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

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="Scenes">
        {SCENES.map(({id, comp}) => {
          const f = sceneFrames(id);
          return (
            <Composition
              key={id}
              id={`scene-${id}`}
              component={comp}
              durationInFrames={f.durationInFrames}
              fps={STORY.meta.fps}
              width={STORY.meta.width}
              height={STORY.meta.height}
            />
          );
        })}
      </Folder>
      <Composition
        id={INTRO_META.id}
        component={MoyuBotIntro}
        durationInFrames={INTRO_META.durationInFrames}
        fps={INTRO_META.fps}
        width={INTRO_META.width}
        height={INTRO_META.height}
      />
    </>
  );
};
