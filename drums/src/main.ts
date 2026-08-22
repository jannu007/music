import { registerServiceWorker } from '../../shared/runtime';
import { DrumApp } from './ui/App';
import './styles/drums.css';

const root = document.getElementById('app');
if (root) {
  new DrumApp(root);
}

registerServiceWorker();
