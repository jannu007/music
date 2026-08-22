import { registerServiceWorker } from '../../shared/runtime';
import { PianoApp } from './ui/App';
import './styles/piano.css';

const root = document.getElementById('app');
if (root) {
  new PianoApp(root);
}

registerServiceWorker();
