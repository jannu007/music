import { App } from './ui/App';
import { basePatch } from './audio/presets';

const root = document.getElementById('app');
if (root) {
  const app = new App(root);
  // 自動テスト／デバッグ用のフック（アプリの動作には影響しません）
  (window as unknown as Record<string, unknown>).__mss = app;
  (window as unknown as Record<string, unknown>).__mssBasePatch = basePatch;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // オフライン対応は必須機能ではないため、登録失敗時は無視する
    });
  });
}
