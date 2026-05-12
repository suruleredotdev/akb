import { createRoot } from 'react-dom/client';
import { App } from './App';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
