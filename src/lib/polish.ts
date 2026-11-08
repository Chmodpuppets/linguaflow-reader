/**
 * 三栏润色（original / corrected / idiomatic）。
 *
 * ⚠️ 目前未接入 UI：按需求「先不用 OpenRouter」，VoiceLab 里的入口与调用已移除，
 * 全站没有任何地方会 import 本文件，因此不会发起任何外部请求。
 * 需要恢复时把 VoiceLab 的 ai-polish-panel 接回去即可，本文件不用改。
 *
 * 公开部署前必须换成服务端代理：Key 放在前端等于对所有人公开。
 */
export interface PolishResult {
  original: string;
  corrected: string;
  idiomatic: string;
}

export async function polishTranscript(transcript: string, apiKey: string, model: string): Promise<PolishResult> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'openrouter/auto',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are an English speaking coach. Return ONLY a compact JSON object with keys original, corrected, idiomatic. original must exactly preserve the user transcript. corrected should fix only grammar and clarity. idiomatic should sound natural without changing the intended meaning. Do not add commentary or markdown.' },
        { role: 'user', content: transcript },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter 返回 ${response.status}，请检查 Key、模型或额度。`);
  const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
  const content = payload.choices?.[0]?.message?.content || '';
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('模型没有返回可识别的 JSON，请重试。');
  const parsed = JSON.parse(match[0]) as PolishResult;
  if (!parsed.original || !parsed.corrected || !parsed.idiomatic) throw new Error('润色结果缺少必要字段，请重试。');
  return parsed;
}
