import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    // AudioWorklet のスクリプトは data: URL に埋め込まれると addModule() に失敗する
    // 環境があるため、必ず独立したファイルとして出力する
    assetsInlineLimit: (filePath: string) => (/worklets?[\\/].*\.js$|-processor\.js$/.test(filePath) ? false : undefined),
    rollupOptions: {
      input: {
        // Akatsuki Synth（シンセ・/synthesizer/ で公開）
        main: resolve(__dirname, 'synthesizer/index.html'),
        // Aozora Grand Piano（グランドピアノ・/piano/ で公開）
        piano: resolve(__dirname, 'piano/index.html'),
        // Hibiki Drum Machine（ドラムマシン・/drums/ で公開）
        drums: resolve(__dirname, 'drums/index.html'),
        // Takibi Guitar（ギター・/guitar/ で公開）
        guitar: resolve(__dirname, 'guitar/index.html'),
        // Kurogane Bass（エレキベース・/bass/ で公開）
        bass: resolve(__dirname, 'bass/index.html'),
        // Hoshizora Vocal（日本語歌声シンセ・/vocal/ で公開）
        vocal: resolve(__dirname, 'vocal/index.html'),
      },
    },
  },
  server: {
    port: 5174,
    host: true
  }
});
