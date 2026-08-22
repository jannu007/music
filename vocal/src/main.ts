import { registerServiceWorker } from '../../shared/runtime';
import { VocalApp } from './ui/App';
import './styles/vocal.css';

const root = document.getElementById('app');
if (root) {
  new VocalApp(root);
}

registerServiceWorker();
