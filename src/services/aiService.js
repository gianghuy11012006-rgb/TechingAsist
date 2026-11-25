const DEFAULT_AI_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_AI_MODEL = 'openai/gpt-oss-120b';
const GROQ_FALLBACK_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.1-8b-instant',
  'qwen/qwen3-32b',
];
const REQUEST_TIMEOUT_MS = 25000;
const MANUAL_FALLBACK_HINT =
  'Bạn vẫn có thể bấm "+ Thêm từ thủ công" để nhập hoặc chỉnh sửa từ trực tiếp trước khi lưu.';

function getAiConfig(overrideKey = '') {
  const env = import.meta.env || {};
  const apiKey = (
    overrideKey ||
    env.VITE_AI_API_KEY ||
    env.VITE_GROQ_API_KEY ||
    ''
  ).trim();

  const rawBaseUrl = (
    env.VITE_AI_BASE_URL || DEFAULT_AI_BASE_URL
  ).trim();

  const endpoint = rawBaseUrl.endsWith('/chat/completions')
    ? rawBaseUrl
    : `${rawBaseUrl.replace(/\/+$/, '')}/chat/completions`;

  const model = (env.VITE_AI_MODEL || DEFAULT_AI_MODEL).trim();

  return { apiKey, endpoint, model };
}

function extractUniqueWords(rawText) {
  const seen = new Set();
  const words = [];

  for (const part of String(rawText || '').split(/[\n,;]+/)) {
    const cleaned = part.trim().replace(/\s+/g, ' ');
    if (!cleaned) continue;
    const dedupeKey = cleaned.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    words.push(cleaned);
  }

  return words;
}

function parseJsonSafe(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!cleaned) {
    throw new Error(`Phản hồi từ AI trống. ${MANUAL_FALLBACK_HINT}`);
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    let start = -1;
    let end = -1;

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      start = firstBrace;
      end = cleaned.lastIndexOf('}');
    } else if (firstBracket !== -1) {
      start = firstBracket;
      end = cleaned.lastIndexOf(']');
    }

    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        throw new Error(
          `Phản hồi từ AI không đúng định dạng JSON hợp lệ. ${MANUAL_FALLBACK_HINT}`
        );
      }
    }

    throw new Error(
      `Phản hồi từ AI không đúng định dạng JSON hợp lệ. ${MANUAL_FALLBACK_HINT}`
    );
  }
}

async function requestChatCompletion({ messages, apiKey, endpoint, model }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        `Yêu cầu AI quá thời gian chờ (${REQUEST_TIMEOUT_MS / 1000}s). ${MANUAL_FALLBACK_HINT}`
      );
    }
    throw new Error(
      `Không thể kết nối tới AI API (${error.message}). ${MANUAL_FALLBACK_HINT}`
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    const detail = errorPayload?.error?.message || `HTTP ${response.status}`;
    const err = new Error(`AI API lỗi: ${detail}. ${MANUAL_FALLBACK_HINT}`);
    err.status = response.status;
    err.code = errorPayload?.error?.code || '';
    throw err;
  }

  const data = await response.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;

  if (!content || typeof content !== 'string') {
    throw new Error(`AI API không trả về nội dung hợp lệ. ${MANUAL_FALLBACK_HINT}`);
  }

  return content;
}

function shouldTryFallbackModel(error) {
  if (!error) return false;
  if ([400, 404, 429, 503].includes(error.status)) {
    return true;
  }
  return /model_not_found|model_decommissioned|does not exist|not have access/i.test(
    `${error.code || ''} ${error.message || ''}`
  );
}

async function callOpenAICompatible({ messages, apiKey, endpoint, model }) {
  const isGroq = endpoint.includes('api.groq.com');
  const candidates = isGroq
    ? Array.from(new Set([model, ...GROQ_FALLBACK_MODELS]))
    : [model];

  let lastError;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidateModel = candidates[i];
    try {
      return await requestChatCompletion({
        messages,
        apiKey,
        endpoint,
        model: candidateModel,
      });
    } catch (error) {
      lastError = error;
      const hasNext = i < candidates.length - 1;
      if (!hasNext || !shouldTryFallbackModel(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

function extractItemsArray(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.items)) return parsed.items;
    if (Array.isArray(parsed.words)) return parsed.words;
    if (Array.isArray(parsed.vocabulary)) return parsed.vocabulary;
    const firstArray = Object.values(parsed).find((val) => Array.isArray(val));
    if (firstArray) return firstArray;
  }
  return null;
}

export async function convertVocabWithAI(rawText, { topic = '', apiKey = '' } = {}) {
  const cleanedWords = extractUniqueWords(rawText);

  if (cleanedWords.length === 0) {
    throw new Error('Vui lòng nhập danh sách từ vựng trước khi chuyển đổi.');
  }

  const config = getAiConfig(apiKey);
  if (!config.apiKey) {
    throw new Error(
      `Chưa cấu hình VITE_AI_API_KEY trong file .env. ${MANUAL_FALLBACK_HINT}`
    );
  }

  const systemPrompt = [
    'Bạn là trợ lý giáo viên tiếng Anh tiểu học & THCS.',
    'Luôn trả về một JSON object thuần hợp lệ có đúng dạng {"items": [...]}, không kèm markdown hay giải thích.',
    'Mỗi phần tử trong "items" phải có đúng 4 trường:',
    '- "en_word": chuỗi từ/cụm từ tiếng Anh chuẩn chính tả.',
    '- "vi_meaning": nghĩa tiếng Việt ngắn gọn, tự nhiên, dễ hiểu cho học sinh.',
    '- "emoji": đúng 1 emoji minh họa phù hợp với nghĩa của từ.',
    '- "part_of_speech": từ loại tiếng Anh ngắn gọn ("noun", "verb", "adj", "adv", "phrase", ...) hoặc null nếu không rõ.',
  ].join('\n');

  const userPrompt = [
    topic ? `Chủ đề bài học: "${topic}".` : '',
    `Hãy chuyển đổi ${cleanedWords.length} mục từ vựng sau thành JSON:`,
    cleanedWords.join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');

  const rawOutput = await callOpenAICompatible({
    ...config,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const parsed = parseJsonSafe(rawOutput);
  const rawList = extractItemsArray(parsed);

  if (!rawList) {
    throw new Error(
      `Kết quả AI không chứa danh sách từ vựng hợp lệ. ${MANUAL_FALLBACK_HINT}`
    );
  }

  const normalized = rawList
    .map((item) => {
      const pos = String(item?.part_of_speech ?? '').trim();
      return {
        en_word: String(item?.en_word ?? '').trim(),
        vi_meaning: String(item?.vi_meaning ?? '').trim(),
        emoji: String(item?.emoji ?? '').trim() || '📘',
        part_of_speech: pos || null,
      };
    })
    .filter((item) => item.en_word.length > 0);

  if (normalized.length === 0) {
    throw new Error(
      `Không trích xuất được từ vựng hợp lệ nào từ phản hồi AI. ${MANUAL_FALLBACK_HINT}`
    );
  }

  return normalized;
}

export function buildFallbackFeedback({
  setTitle,
  score,
  linesCleared,
  totalWords,
  correctWords,
  missedWords = [],
  maxCombo = 0,
}) {
  const accuracy = totalWords > 0 ? Math.round((correctWords / totalWords) * 100) : 0;

  let praise = 'Bạn đã hoàn thành ván chơi rất tốt!';
  if (accuracy >= 90 && totalWords > 0) {
    praise = 'Xuất sắc! Bạn ghi nhớ gần như trọn vẹn toàn bộ từ vựng trong bài.';
  } else if (accuracy >= 70) {
    praise = 'Làm tốt lắm! Bạn nắm khá chắc nghĩa và chính tả của các từ vựng.';
  } else if (accuracy >= 40) {
    praise = 'Cố gắng đáng khen! Hãy ôn lại một vài từ vừa gặp để ghi nhớ sâu hơn nhé.';
  } else {
    praise = 'Khởi đầu tốt rồi! Chơi lại thêm một lượt nữa để nhớ từ nhanh hơn nhé.';
  }

  const statsLine = `Bộ "${setTitle || 'Từ vựng'}": đúng ${correctWords}/${totalWords} từ (${accuracy}%), đạt ${score} điểm, phá ${linesCleared} hàng/cột (combo tối đa x${maxCombo}).`;

  if (missedWords.length > 0) {
    const reviewList = missedWords
      .slice(0, 5)
      .map((w) => `${w.emoji || '📘'} ${w.en_word} (${w.vi_meaning})`)
      .join(', ');
    return `${praise} ${statsLine} Từ cần ôn lại: ${reviewList}.`;
  }

  return `${praise} ${statsLine}`;
}

export async function generateGameFeedback(summary, apiKey = '') {
  const fallback = buildFallbackFeedback(summary);
  const config = getAiConfig(apiKey);

  if (!config.apiKey) {
    return fallback;
  }

  try {
    const missedText = (summary.missedWords || [])
      .slice(0, 8)
      .map((w) => `${w.en_word} (${w.vi_meaning})`)
      .join(', ');

    const prompt = [
      'Viết nhận xét ngắn gọn (2-3 câu, tiếng Việt thân thiện, khích lệ học sinh) sau ván game Block Blast học từ vựng tiếng Anh.',
      'Trả về JSON object thuần có đúng 1 trường: {"feedback": "..."}',
      `Bộ từ: ${summary.setTitle || 'Không rõ'}`,
      `Chủ đề: ${summary.topic || 'Tổng hợp'}`,
      `Điểm số: ${summary.score}, Số hàng/cột phá được: ${summary.linesCleared}, Combo tối đa: ${summary.maxCombo}`,
      `Số từ đúng: ${summary.correctWords}/${summary.totalWords}`,
      missedText ? `Các từ chưa thuộc / bỏ qua: ${missedText}` : 'Không sai từ nào.',
    ].join('\n');

    const rawOutput = await callOpenAICompatible({
      ...config,
      messages: [
        {
          role: 'system',
          content: 'Bạn là giáo viên tiếng Anh thân thiện. Chỉ trả về JSON object hợp lệ.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const parsed = parseJsonSafe(rawOutput);
    const text = String(parsed?.feedback ?? '').trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}
