import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './style.css';

// No <StrictMode> on purpose: it runs effects twice in development,
// which would start the emulator twice.
createRoot(document.getElementById('root')).render(<App />);
