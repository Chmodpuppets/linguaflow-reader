import type { DictionaryEntry } from '../types';

const entries: Record<string, DictionaryEntry> = {
  attention: { word: 'attention', phonetic: '/əˈtenʃən/', partOfSpeech: 'noun', meaning: 'The mental focus you give to someone or something.', chinese: '注意力；关注', usage: 'Use “pay attention to” for the act of focusing; “give attention to” sounds more formal.', example: 'She gave the detail her full attention.', exampleCn: '她全神贯注地关注那个细节。', synonyms: ['focus', 'concentration', 'notice'] },
  deliberate: { word: 'deliberate', phonetic: '/dɪˈlɪbərət/', partOfSpeech: 'adjective', meaning: 'Done consciously and intentionally, often with care.', chinese: '刻意的；深思熟虑的', usage: 'Useful for choices and practice: a deliberate decision, deliberate practice.', example: 'He made a deliberate effort to slow down.', exampleCn: '他有意识地努力放慢速度。', synonyms: ['intentional', 'conscious', 'planned'] },
  subtle: { word: 'subtle', phonetic: '/ˈsʌtəl/', partOfSpeech: 'adjective', meaning: 'Not obvious or loud; delicate and requiring attention to notice.', chinese: '微妙的；不易察觉的', usage: 'The b is silent. Common pairs: subtle difference, subtle change, subtle hint.', example: 'There was a subtle shift in her tone.', exampleCn: '她的语气发生了细微变化。', synonyms: ['slight', 'delicate', 'understated'] },
  curiosity: { word: 'curiosity', phonetic: '/ˌkjʊəriˈɒsəti/', partOfSpeech: 'noun', meaning: 'A strong desire to know, explore, or learn something.', chinese: '好奇心；求知欲', usage: '“Out of curiosity” explains why you asked; “arouse curiosity” means to create interest.', example: 'Curiosity led her back to the same question.', exampleCn: '好奇心让她重新回到那个问题。', synonyms: ['interest', 'inquisitiveness', 'wonder'] },
  ordinary: { word: 'ordinary', phonetic: '/ˈɔːdənəri/', partOfSpeech: 'adjective', meaning: 'Normal and not special or unusual.', chinese: '普通的；平常的', usage: '“Out of the ordinary” is the useful opposite: unusual or exceptional.', example: 'He found beauty in an ordinary morning.', exampleCn: '他在一个平常的清晨发现了美。', synonyms: ['common', 'everyday', 'usual'] },
  cultivate: { word: 'cultivate', phonetic: '/ˈkʌltɪveɪt/', partOfSpeech: 'verb', meaning: 'To develop a quality, skill, or relationship through care and practice.', chinese: '培养；培育', usage: 'Beyond farming: cultivate a habit, cultivate patience, cultivate relationships.', example: 'Reading helps cultivate a more patient mind.', exampleCn: '阅读有助于培养更有耐心的头脑。', synonyms: ['develop', 'nurture', 'foster'] },
  clutter: { word: 'clutter', phonetic: '/ˈklʌtə/', partOfSpeech: 'noun', meaning: 'A collection of things that make a space or mind feel disorganized.', chinese: '杂乱；干扰物', usage: 'Works literally and figuratively: digital clutter, mental clutter, clear the clutter.', example: 'She removed the clutter from her desk.', exampleCn: '她清理了桌上的杂物。', synonyms: ['mess', 'disorder', 'noise'] },
  friction: { word: 'friction', phonetic: '/ˈfrɪkʃən/', partOfSpeech: 'noun', meaning: 'Difficulty or resistance that makes an action harder.', chinese: '阻力；摩擦', usage: 'In product and habits, “reduce friction” means making the desired action easier.', example: 'Fewer steps reduced the friction of getting started.', exampleCn: '更少的步骤降低了开始的阻力。', synonyms: ['resistance', 'difficulty', 'tension'] },
  fleeting: { word: 'fleeting', phonetic: '/ˈfliːtɪŋ/', partOfSpeech: 'adjective', meaning: 'Lasting for a very short time.', chinese: '短暂的；转瞬即逝的', usage: 'Often used with moment, glimpse, thought, impression, or beauty.', example: 'The notebook preserved a fleeting thought.', exampleCn: '笔记本留住了一个转瞬即逝的想法。', synonyms: ['brief', 'momentary', 'passing'] },
  retain: { word: 'retain', phonetic: '/rɪˈteɪn/', partOfSpeech: 'verb', meaning: 'To keep something or continue to remember it.', chinese: '保留；记住', usage: 'More formal than remember: retain information, retain control, retain heat.', example: 'Stories help us retain new information.', exampleCn: '故事帮助我们记住新信息。', synonyms: ['keep', 'preserve', 'remember'] },
  compound: { word: 'compound', phonetic: '/ˈkɒmpaʊnd/', partOfSpeech: 'adjective', meaning: 'Made up of parts that combine and increase over time.', chinese: '复合的；累积的', usage: '“Compound growth” describes growth building on previous growth; as a verb, compound can mean worsen.', example: 'Small improvements produced compound benefits.', exampleCn: '微小的改进产生了累积的益处。', synonyms: ['combined', 'cumulative', 'composite'] },
  resilient: { word: 'resilient', phonetic: '/rɪˈzɪliənt/', partOfSpeech: 'adjective', meaning: 'Able to recover or continue after difficulty or change.', chinese: '有韧性的；能复原的', usage: 'Used for people, systems, cities, and materials: a resilient routine, a resilient economy.', example: 'A resilient plan can survive a difficult week.', exampleCn: '有韧性的计划能经受住艰难的一周。', synonyms: ['adaptable', 'durable', 'strong'] },
  ambiguity: { word: 'ambiguity', phonetic: '/ˌæmbɪˈɡjuːəti/', partOfSpeech: 'noun', meaning: 'The quality of having more than one possible meaning or interpretation.', chinese: '模糊性；多重含义', usage: 'Useful in language and design: avoid ambiguity, embrace ambiguity, resolve ambiguity.', example: 'The sentence was open to ambiguity.', exampleCn: '这个句子存在歧义。', synonyms: ['uncertainty', 'vagueness', 'openness'] },
  linger: { word: 'linger', phonetic: '/ˈlɪŋɡə/', partOfSpeech: 'verb', meaning: 'To stay longer because you are reluctant to leave.', chinese: '逗留；流连', usage: '“Linger over” means to spend enjoyable time on something; smells and memories can also linger.', example: 'Readers lingered over the final paragraph.', exampleCn: '读者们细细品读最后一段。', synonyms: ['stay', 'remain', 'dwell'] },
  profound: { word: 'profound', phonetic: '/prəˈfaʊnd/', partOfSpeech: 'adjective', meaning: 'Very deep, meaningful, or strongly felt.', chinese: '深刻的；意义深远的', usage: 'Common with insight, change, impact, silence, and understanding.', example: 'The small experience had a profound effect.', exampleCn: '那段小小的经历产生了深远的影响。', synonyms: ['deep', 'meaningful', 'significant'] },
};

export function normalizeWord(input: string): string {
  const cleaned = input.toLowerCase().replace(/^[^a-z]+|[^a-z'-]+$/g, '');
  if (entries[cleaned]) return cleaned;
  const candidates = [cleaned.replace(/'s$/, ''), cleaned.replace(/s$/, ''), cleaned.replace(/ing$/, ''), cleaned.replace(/ed$/, '')];
  return candidates.find((word) => entries[word]) || cleaned;
}

export function lookupWord(input: string): DictionaryEntry | undefined {
  return entries[normalizeWord(input)];
}

export function allDictionaryWords(): string[] {
  return Object.keys(entries);
}
