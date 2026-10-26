import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { createStorage } from './lib/storage.ts';
import { StorageContext } from './lib/useStoredData.ts';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/features.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element in index.html');
}

const queryClient = new QueryClient({
  defaultOptions: {
    // The API caches sources for 5 to 30 minutes, so refetching sooner gains nothing.
    queries: { staleTime: 5 * 60 * 1000, retry: 1 },
  },
});

// Looked up on each call: reading window.localStorage throws when the browser blocks storage,
// and createStorage handles that per call (reads fall back to defaults, writes report it).
const storage = createStorage({
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
});

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <StorageContext value={storage}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </StorageContext>
    </ErrorBoundary>
  </StrictMode>,
);
