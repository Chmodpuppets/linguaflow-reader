import type { Book, WordGloss } from '../types';

// 分级入门书架：把公版寓言（伊索）用受控词汇改写到 A1 / A2 / B1，
// 作为冷启动用户的 i+1 入口桥——先读得动，再逐步过渡到原著。
// 内容为公版故事的原创简写，不涉版权；随主包静态就位，source='sample' 走 hydrate/slim。

function book(id: string, level: string, title: string, cover: string, accent: string, description: string, paragraphs: string[]): Book {
  return {
    id,
    title,
    author: 'Aesop · 分级改写',
    description,
    cover,
    accent,
    progress: 0,
    currentChapter: 0,
    currentParagraph: 0,
    addedAt: '2026-11-13T08:00:00.000Z',
    source: 'sample',
    level,
    chapters: [{ id: `${id}-1`, title, paragraphs }],
  };
}

export const gradedBooks: Book[] = [
  book(
    'graded-a1-hare',
    'A1',
    'The Tortoise and the Hare',
    'A1 · HARE',
    '#10b981',
    '入门级：短句与基础词，适合刚开始读英文的你。',
    [
      'A hare runs fast. A tortoise walks slow.',
      "The hare laughs at the tortoise. 'You are so slow!' he says.",
      "The tortoise smiles. 'Let us race,' he says.",
      'The hare runs, then stops. He sleeps under a tree.',
      'The tortoise walks and walks. He does not stop.',
      'The hare wakes up. The tortoise is at the finish line. Slow and steady wins the race.',
    ],
  ),
  book(
    'graded-a2-wind',
    'A2',
    'The North Wind and the Sun',
    'A2 · SUN',
    '#f59e0b',
    '进阶级：稍长的句子与常见动词，练习连句成段。',
    [
      'The North Wind and the Sun argue about who is stronger.',
      'They see a man walking on the road. He wears a warm coat.',
      "'I can make him take off his coat,' says the Wind. He blows hard and cold.",
      'But the man only holds his coat tighter. The Wind cannot win.',
      'Then the Sun shines warmly. The man feels hot and takes off his coat.',
      'Gentleness can succeed where force fails.',
    ],
  ),
  book(
    'graded-b1-lion',
    'B1',
    'The Lion and the Mouse',
    'B1 · LION',
    '#8b5cf6',
    '桥接级：从句与叙事词汇，为读原著做铺垫。',
    [
      'A lion was sleeping when a tiny mouse ran across his paw and woke him.',
      'The lion caught the mouse and opened his great mouth to swallow her.',
      "'Spare me!' cried the mouse. 'If you let me go, I may one day repay your kindness.'",
      'The lion laughed at the idea that a mouse could help a lion, but he let her go.',
      "Days later the lion was trapped in a hunter's net. His roars could not free him.",
      'The mouse heard him, gnawed the ropes, and set the lion free. Even the small can help the great.',
    ],
  ),
];

// 为分级书架预置注音释义：切到「全部有释义」即可看到 ruby，降低冷启动查词摩擦。
export const gradedGlosses: Record<string, WordGloss> = {
  hare: { zh: '野兔' },
  tortoise: { zh: '陆龟' },
  race: { zh: '赛跑' },
  steady: { zh: '稳定的' },
  finish: { zh: '终点' },
  argue: { zh: '争论' },
  stronger: { zh: '更强' },
  coat: { zh: '外套' },
  blows: { zh: '吹' },
  gentleness: { zh: '温和' },
  force: { zh: '武力' },
  succeed: { zh: '成功' },
  paw: { zh: '爪子' },
  swallow: { zh: '吞下' },
  spare: { zh: '饶恕' },
  repay: { zh: '回报' },
  kindness: { zh: '善意' },
  trapped: { zh: '被困住' },
  net: { zh: '网' },
  gnawed: { zh: '啃咬' },
  ropes: { zh: '绳子' },
};
