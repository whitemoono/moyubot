import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MoyuProvider } from './state';
import './styles/liquid.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MoyuProvider>
      <App />
    </MoyuProvider>
  </StrictMode>,
);