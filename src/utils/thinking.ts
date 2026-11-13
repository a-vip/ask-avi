export interface ParsedThoughtReply {
  thinking: string;
  answer: string;
  isThinking: boolean;
}

const OPEN_TAG_RE = /^\s*<(?:thought|think)\b[^>]*>/i;
const CLOSE_TAG_RE = /<\/(?:thought|think)>/i;

/**
 * Splits optional `<thought>...</thought>` (or `<think>...</think>`) reasoning
 * prefixes from the conversational answer during both streaming and idle states.
 */
export function splitThinkingAndAnswer(raw: string): ParsedThoughtReply {
  if (!raw) {
    return { thinking: '', answer: '', isThinking: false };
  }

  const openMatch = raw.match(OPEN_TAG_RE);
  if (!openMatch) {
    // Handle case where a closing tag appears after untagged preamble or normal reply
    return {
      thinking: '',
      answer: raw.replace(/<\/?(?:thought|think)\b[^>]*>/gi, '').trimStart(),
      isThinking: false,
    };
  }

  const afterOpen = raw.slice(openMatch[0].length);
  const closeMatch = afterOpen.match(CLOSE_TAG_RE);

  if (!closeMatch || closeMatch.index === undefined) {
    return {
      thinking: afterOpen.trim(),
      answer: '',
      isThinking: true,
    };
  }

  const thinking = afterOpen.slice(0, closeMatch.index).trim();
  const answer = afterOpen
    .slice(closeMatch.index + closeMatch[0].length)
    .replace(/^\s+/, '');

  return {
    thinking,
    answer,
    isThinking: false,
  };
}
