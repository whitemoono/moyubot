import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MeshProvider } from './state';
import './styles/liquid.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MeshProvider>
      <App />
    </MeshProvider>
  </StrictMode>,
);