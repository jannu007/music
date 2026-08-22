import { registerServiceWorker } from '../../shared/runtime';
import { BassApp } from './ui/App';
import './styles/bass.css';

const root = document.getElementById('app');
if (root) {
  new BassApp(root);
}

registerServiceWorker();
