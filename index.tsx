import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

// StrictMode intentionally omitted to prevent double-render issues with Tone.js
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
