/** Whisper 带时间戳转写的最小共享结构（主线程 ↔ Worker）。 */
export interface TimedChunk {
  /** 相对整条音频起点的秒数（已加上分片 offset）。 */
  start: number;
  end: number;
  text: string;
}
