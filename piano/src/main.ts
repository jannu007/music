import { PianoApp } from './ui/App';
import './styles/piano.css';

const root = document.getElementById('app');
if (root) {
  new PianoApp(root);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // オフライン動作は必須ではないため、登録に失敗しても無視する
    });
  });
}
