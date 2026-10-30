import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MoyuProvider } from './state';
import './styles/liquid.css';
import './styles/workspace.css';
import './styles/settings.css';
import './styles/usage.css';
import './styles/context-meter.css';
import './styles/effort.css';
import './styles/model-limits.css';
import './styles/perf.css';
import './styles/terminal-command.css';
import './styles/reply-flow.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MoyuProvider>
      <App />
    </MoyuProvider>
  </StrictMode>,
);
