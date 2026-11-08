import type { DiffToken, VoiceMetrics } from '../types';

export interface SpeechResultEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: { isFinal: boolean; [index: number]: { transcript: string; confidence: number } };
  };
}

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export function speechRecognitionFactory(): (new () => SpeechRecognitionLike) | null {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function wordTokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) || [];
}

export function diffTranscript(target: string, transcript: string, confidence = 1): DiffToken[] {
  const expected = wordTokens(target);
  const spoken = wordTokens(transcript);
  const rows = expected.length + 1;
  const cols = spoken.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = 1; i < rows; i += 1) dp[i][0] = i;
  for (let j = 1; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] = expected[i - 1] === spoken[j - 1]
        ? dp[i - 1][j - 1]
        : Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1;
    }
  }
  const tokens: DiffToken[] = [];
  let i = expected.length;
  let j = spoken.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && expected[i - 1] === spoken[j - 1]) {
      tokens.push({ text: expected[i - 1], spoken: spoken[j - 1], status: confidence < 0.68 ? 'low' : 'match', confidence });
      i -= 1; j -= 1;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      tokens.push({ text: expected[i - 1], spoken: spoken[j - 1], status: 'substitute', confidence });
      i -= 1; j -= 1;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      tokens.push({ text: expected[i - 1], status: 'missing' });
      i -= 1;
    } else {
      tokens.push({ text: spoken[j - 1], status: 'extra', confidence });
      j -= 1;
    }
  }
  return tokens.reverse();
}

export function voiceMetrics(target: string, transcript: string, tokens: DiffToken[], duration: number, pauseRatio: number): VoiceMetrics {
  const count = wordTokens(transcript).length;
  const expectedCount = wordTokens(target).length;
  const correct = tokens.filter((token) => token.status === 'match' || token.status === 'low').length;
  // 只统计明确的口头禅；排除 "like"，因为它作为正常介词/动词太常见，会虚高。
  // um+/uh+/er+/ah+/hmm+ 覆盖拖长（umm、uhhh）；"you know / i mean / you see" 组合更明确。
  const fillerCount = (transcript.toLowerCase().match(/\b(um+|uh+|er+|ah+|hmm+|you know|i mean|you see)\b/g) || []).length;
  const speakingMinutes = Math.max(0.1, (duration * (1 - pauseRatio)) / 60);
  return {
    wpm: count ? Math.round(count / speakingMinutes) : 0,
    pauseRatio: Math.round(pauseRatio * 100),
    accuracy: expectedCount ? Math.round((correct / Math.max(expectedCount, count)) * 100) : 0,
    duration: Math.round(duration),
    wordCount: count,
    fillerCount,
  };
}

const STOP_WORDS = new Set('about after again against almost along already also although always among another anything around because before being below between both could does doing during each either enough every first from going great having himself herself however itself little many might more most other others ourselves really should some something sometimes still their theirs them themselves there these they thing things those through under until very were what when where which while would your yours'.split(' '));

export function extractKeywords(text: string, limit = 5): string[] {
  const counts = new Map<string, number>();
  wordTokens(text).forEach((word) => {
    if (word.length < 4 || STOP_WORDS.has(word)) return;
    counts.set(word, (counts.get(word) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, limit).map(([word]) => word);
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function localDay(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
