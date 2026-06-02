import { Provider } from 'jotai';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <Provider>
    <App />
  </Provider>,
);
