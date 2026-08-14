import { DrumApp } from './ui/App';
import './styles/drums.css';

const root = document.getElementById('app');
if (root) {
  new DrumApp(root);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // オフライン動作は必須ではないため、登録に失敗しても無視する
    });
  });
}
