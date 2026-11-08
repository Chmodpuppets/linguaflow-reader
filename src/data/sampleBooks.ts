import type { Book } from '../types';

// 注意：此文件必须保持「轻量」。内置扫描书（wimpyKidBook，含 226 页 OCR 块）
// 体量约 400KB+，由 ./builtinBooks 动态 import，绝不能在这里静态引入，
// 否则首屏 bundle 会被整本书拖到 680KB。
export const sampleBooks: Book[] = [
  {
    id: 'art-of-noticing',
    title: 'The Art of Noticing',
    author: 'LinguaFlow Studio',
    description: 'A field guide to attention, curiosity, and the ordinary details that make a life feel larger.',
    cover: 'NOTICING',
    accent: '#8b5cf6',
    progress: 32,
    currentChapter: 0,
    currentParagraph: 0,
    addedAt: '2026-10-20T08:00:00.000Z',
    lastReadAt: '2026-10-27T01:00:00.000Z',
    source: 'sample',
    chapters: [
      {
        id: 'noticing-1',
        title: 'The world is not finished',
        paragraphs: [
          'Attention is often described as a spotlight, but it also resembles a garden gate. What we allow through it becomes the landscape of our inner life. A deliberate choice to notice one thing can quietly change the meaning of everything around it.',
          'Most days, we move through familiar streets without truly seeing them. The mind loves efficiency, so it replaces the world with labels: home, shop, station. The ordinary becomes invisible not because it lacks detail, but because we have stopped asking it questions.',
          'Curiosity interrupts this automatic process. It asks us to look again, to find one subtle difference in a familiar place. A cracked tile, a new plant on a balcony, or the rhythm of footsteps can become a small door out of routine.',
          'This practice does not require more time. It requires less hurry. When we pause for ten seconds before crossing a road, we give the senses permission to gather what the schedule would otherwise discard.',
          'The world is not finished being interesting. Our description of it is. Every act of noticing revises that description, adding texture where there was once only a name.',
        ],
      },
      {
        id: 'noticing-2',
        title: 'A quieter kind of ambition',
        paragraphs: [
          'We often imagine ambition as a loud force: bigger goals, faster growth, a longer list of achievements. Yet there is a quieter ambition in learning to be present with what already exists.',
          'To cultivate attention is to resist the idea that value always lives elsewhere. The conversation in front of us, the page open beneath our hands, and the person across the table all ask for the same simple gift: undivided presence.',
          'Digital clutter makes this gift difficult to offer. Each small interruption leaves a residue, a fragment of the previous task that follows us into the next. Reducing friction is helpful, but reducing unnecessary entry points matters even more.',
          'A quieter ambition is not a smaller life. It is a life with fewer hollow spaces, where experience has enough time to leave an impression.',
        ],
      },
      {
        id: 'noticing-3',
        title: 'Keep a record of wonder',
        paragraphs: [
          'Memory is selective, so a notebook can become an instrument of attention. Record not only what happened, but what surprised you. Surprise is evidence that the world exceeded your model of it.',
          'A useful entry need not be profound. Write down a phrase you wanted to steal, a question you could not answer, or a fleeting image that stayed with you. These details are easier to retain because they carry a personal charge.',
          'Over time, such notes reveal patterns that a single day cannot show. You may discover that your curiosity returns to the same themes, asking for a more deliberate place in your life.',
          'The purpose is not to collect beautiful observations. It is to become the kind of person who makes them.',
        ],
      },
    ],
  },
  {
    id: 'small-systems',
    title: 'Small Systems, Real Change',
    author: 'Mira Chen',
    description: 'Essays about gentle structure, meaningful work, and designing conditions for action.',
    cover: 'SYSTEMS',
    accent: '#22d3ee',
    progress: 8,
    currentChapter: 0,
    currentParagraph: 0,
    addedAt: '2026-10-18T08:00:00.000Z',
    source: 'sample',
    chapters: [
      {
        id: 'systems-1',
        title: 'Motivation is not a plan',
        paragraphs: [
          'Motivation is weather; structure is shelter. We can enjoy a bright morning without pretending that every morning will be bright. A resilient routine makes room for both energy and fatigue.',
          'The most useful system is often embarrassingly small. One page, one conversation, one delivered piece of work. Its modest scale is not a weakness but a source of momentum.',
          'Good design lowers the cost of beginning. When the next action is visible and the materials are ready, intention has somewhere to land.',
        ],
      },
      {
        id: 'systems-2',
        title: 'Make progress visible',
        paragraphs: [
          'A finished artifact creates a different kind of confidence from a perfect plan. It gives reality an opportunity to respond, and gives us something specific to improve.',
          'Compound growth is easy to admire and difficult to notice. Daily effort can feel flat because the curve only becomes visible from a distance.',
          'Keep a record of what crossed the boundary from idea to reality. That record is not vanity; it is a map of your capacity.',
        ],
      },
    ],
  },
  {
    id: 'cities-for-people',
    title: 'Cities for People',
    author: 'Jonas Field',
    description: 'Short observations on streets, public space, and the social life of cities.',
    cover: 'CITIES',
    accent: '#f472b6',
    progress: 0,
    currentChapter: 0,
    currentParagraph: 0,
    addedAt: '2026-10-12T08:00:00.000Z',
    source: 'sample',
    chapters: [
      {
        id: 'cities-1',
        title: 'The sidewalk as a room',
        paragraphs: [
          'A good sidewalk is more than a route from one interior to another. It is a room without a ceiling, furnished with trees, windows, benches, and the possibility of meeting.',
          'People linger where they feel both sheltered and free. A blank wall hurries them along; an open doorway gives the street a pulse.',
          'The measure of a street is not only how quickly it moves us, but whether it ever gives us a reason to stop.',
        ],
      },
      {
        id: 'cities-2',
        title: 'Ambiguity and play',
        paragraphs: [
          'The most beloved public spaces contain a useful ambiguity. A low wall can be a boundary, a seat, or a stage. Children understand this immediately.',
          'Play begins when a place permits more than one interpretation. Design can provide that permission without prescribing the activity.',
          'A city becomes resilient when its ordinary objects can serve more than their official purpose.',
        ],
      },
    ],
  },
];
