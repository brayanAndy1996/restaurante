import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { SesionProvider } from './modulos/acceso/sesion';
import './estilos.css';

const clienteDeConsultas = new QueryClient({
  defaultOptions: {
    queries: {
      // El cliente de lib/api.ts ya reintenta con esperas; TanStack no repite por su cuenta.
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
    // Las escrituras reintentan solas en lib/api.ts y lib/envios.ts: TanStack no las pausa sin red.
    mutations: { networkMode: 'always' },
  },
});

createRoot(document.getElementById('raiz') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={clienteDeConsultas}>
      <BrowserRouter>
        <SesionProvider>
          <App />
        </SesionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
