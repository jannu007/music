import { registerServiceWorker } from '../../shared/runtime';
import { GuitarApp } from './ui/App';
import './styles/guitar.css';

const root = document.getElementById('app');
if (root) {
  new GuitarApp(root);
}

registerServiceWorker();
