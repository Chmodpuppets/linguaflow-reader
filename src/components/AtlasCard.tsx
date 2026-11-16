import { useState } from 'react';
import { Volume2, Lightbulb, ImageOff } from 'lucide-react';
import { atlasMediaUrls, type AtlasWord } from '../lib/wordAtlas';

/** 播放源站真人录音；无媒体或加载失败时回退浏览器 TTS，保证始终能发音。 */
function play(url: string | undefined, text: string) {
  if (url) {
    const audio = new Audio(url);
    audio.play().catch(() => speakFallback(text));
    audio.addEventListener('error', () => speakFallback(text), { once: true });
    return;
  }
  speakFallback(text);
}
function speakFallback(text: string) {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US'; u.rate = 0.95;
  speechSynthesis.speak(u);
}

function Chips({ label, items, tone }: { label: string; items: string[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <div className="atlas-chips-row">
      <span className="atlas-chips-label">{label}</span>
      <span className={`atlas-chips${tone ? ` ${tone}` : ''}`}>{items.map((c) => <span className="atlas-chip" key={c}>{c}</span>)}</span>
    </div>
  );
}

/** Word Atlas（词光）富词条增强卡：插画 / CEFR / 英美真人发音 / 双语例句 / 搭配词族 / 记忆提示。
 *  独立 .atlas-* 样式，不改动基础查词面板；媒体按需懒加载，失败安静降级。CC BY 4.0 署名常驻。 */
export default function AtlasCard({ data, queryWord }: { data: AtlasWord; queryWord: string }) {
  const media = atlasMediaUrls(data.id, data.media);
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = !!media.thumb && !imgFailed;

  return (
    <div className="atlas-card">
      <div className="atlas-head">
        <span className="atlas-cefr" title="CEFR 难度等级">{data.cefr}</span>
        {data.topicZh && <span className="atlas-topic">{data.topicZh}</span>}
        {data.lemmaOf && data.lemmaOf.toLowerCase() !== queryWord.toLowerCase() && (
          <span className="atlas-lemma">原形 {data.lemmaOf}</span>
        )}
        <span className="atlas-brand">WORD ATLAS · 词光</span>
      </div>

      {showImg && (
        <img className="atlas-img" src={media.thumb} alt={`${data.word} 插画`} loading="lazy" onError={() => setImgFailed(true)} />
      )}
      {!showImg && media.img && imgFailed && (
        <div className="atlas-img-fallback"><ImageOff size={14} aria-hidden="true" /> 插画暂不可用</div>
      )}

      <div className="atlas-pron">
        {data.uk && (
          <button type="button" className="atlas-pron-btn" onClick={() => play(media.uk, data.word)} title="英式发音">
            <Volume2 size={13} aria-hidden="true" /><span className="atlas-accent">UK</span><span className="atlas-ipa">/{data.uk}/</span>
          </button>
        )}
        {data.us && (
          <button type="button" className="atlas-pron-btn" onClick={() => play(media.us, data.word)} title="美式发音">
            <Volume2 size={13} aria-hidden="true" /><span className="atlas-accent">US</span><span className="atlas-ipa">/{data.us}/</span>
          </button>
        )}
      </div>

      {data.ex.length > 0 && (
        <div className="atlas-examples">
          {data.ex.slice(0, 2).map((e, i) => (
            <div className="atlas-example" key={i}>
              <button type="button" className="atlas-example-play" onClick={() => play(i === 0 ? media.ex : media.ex1, e.en)} title="朗读例句"><Volume2 size={12} aria-hidden="true" /></button>
              <div className="atlas-example-text"><p className="atlas-example-en">{e.en}</p><p className="atlas-example-zh">{e.zh}</p></div>
            </div>
          ))}
        </div>
      )}

      <Chips label="搭配" items={data.col.slice(0, 6)} />
      <Chips label="词族" items={data.fam.slice(0, 8)} />
      <Chips label="近义" items={data.syn.slice(0, 6)} tone="syn" />
      <Chips label="反义" items={data.ant.slice(0, 6)} tone="ant" />

      {data.tip && (
        <div className="atlas-tip"><Lightbulb size={13} aria-hidden="true" /><span>{data.tip}</span></div>
      )}

      <div className="atlas-credit">词库 <a href="https://github.com/designfuchen/word-atlas" target="_blank" rel="noreferrer">Word Atlas</a> · CC BY 4.0</div>
    </div>
  );
}
