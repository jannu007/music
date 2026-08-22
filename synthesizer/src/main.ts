import { registerServiceWorker } from '../../shared/runtime';
import { App } from './ui/App';
import { basePatch } from './audio/presets';

const root = document.getElementById('app');
if (root) {
  const app = new App(root);
  // 自動テスト／デバッグ用のフック（アプリの動作には影響しません）
  (window as unknown as Record<string, unknown>).__mss = app;
  (window as unknown as Record<string, unknown>).__mssBasePatch = basePatch;
}

registerServiceWorker();
