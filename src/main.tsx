import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { ConfirmDialogProvider } from './context/ConfirmDialogContext.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ConfirmDialogProvider>
        <App />
      </ConfirmDialogProvider>
    </ThemeProvider>
  </StrictMode>,
);

