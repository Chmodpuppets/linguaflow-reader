import type { TimedChunk } from './whisperTypes';

// ── 字幕（SRT / VTT）解析 ──────────────────────────────────────────────────────
// 把视频字幕一步变成「带精确句级时间轴」的课程：字幕自带每句起止时间，无需语音识别，
// 时间轴比 Whisper 估计更准。纯函数，便于单测；不依赖 DOM / 浏览器 API。

export interface SubtitleCue {
  /** 相对视频起点的秒数。 */
  start: number;
  end: number;
  text: string;
}

const SUBTITLE_EXT = /\.(srt|vtt)$/i;

export function isSubtitleFile(name: string): boolean {
  return SUBTITLE_EXT.test(name);
}

/** 解析 `HH:MM:SS,mmm` / `HH:MM:SS.mmm` / `MM:SS.mmm`（SRT 用逗号、VTT 用点，小时可省）。 */
export function parseTimestamp(raw: string): number | null {
  const match = raw.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!match) return null;
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const millis = parseInt(match[4].padEnd(3, '0'), 10);
  if (minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

/** 去掉 VTT 内联标签（<i>/<b>/<00:00:02.000> 卡拉OK时间戳等）与基本实体，折叠空白。 */
export function cleanCueText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 解析 SRT / VTT 文本为按时间排序、去重的字幕句。
 * 以「含 --> 的行」定位每条字幕：该行之前是序号/ cue id（忽略），之后是正文（可多行）。
 * 跳过 WEBVTT 头 / NOTE / STYLE / REGION 等无 --> 的块。
 */
export function parseSubtitles(content: string): SubtitleCue[] {
  const normalized = content.replace(/\r\n?/g, '\n').replace(/^/, '');
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const lines = block.split('\n');
    const arrowIndex = lines.findIndex((line) => line.includes('-->'));
    if (arrowIndex < 0) continue;
    const arrowLine = lines[arrowIndex];
    const arrowAt = arrowLine.indexOf('-->');
    const start = parseTimestamp(arrowLine.slice(0, arrowAt));
    const end = parseTimestamp(arrowLine.slice(arrowAt + 3).trim().split(/\s+/)[0]);
    if (start === null || end === null) continue;
    const text = cleanCueText(lines.slice(arrowIndex + 1).join(' '));
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cues.push({ start, end: Math.max(end, start + 0.25), text });
  }
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/** 字幕句 → 与 Whisper 转写同构的 TimedChunk，复用建课的分组/时间轴纯函数。 */
export function cuesToChunks(cues: SubtitleCue[]): TimedChunk[] {
  return cues.map((cue) => ({ start: cue.start, end: cue.end, text: cue.text }));
}
