import { registerServiceWorker } from '../../shared/runtime';
import { SamplerApp } from './ui/App';
import './styles/sampler.css';

/*
 * 他サイトの枠（iframe）の中に置かれていないか確かめる。
 *
 * 枠の中に隠して置き、その上に別の見た目をかぶせて、利用者が押したつもりのない
 * ものを押させる——という手口がある（クリックジャッキング）。このアプリには
 * マイクの許可を求める操作があるので、無関係なページに埋め込ませない。
 *
 * 本来これは frame-ancestors で止めるべきものだが、あの指定は HTTP ヘッダーで
 * しか効かず、静的配信では付けられない。そこで本体側で見て、枠の中なら
 * 起動せずに知らせる。
 */
function framedByAnotherSite(): boolean {
  try {
    return window.top !== window.self && window.top?.location.origin !== window.location.origin;
  } catch {
    // origin が違うと参照した時点で例外になる。それ自体が別サイトの枠にいる証拠
    return true;
  }
}

const root = document.getElementById('app');
if (root) {
  if (framedByAnotherSite()) {
    root.textContent = 'Yamabiko Sampler cannot run inside another site.';
  } else {
    new SamplerApp(root);
    registerServiceWorker();
  }
}
