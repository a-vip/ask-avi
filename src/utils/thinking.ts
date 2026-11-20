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


const META_REASONING_LINE_RES: RegExp[] = [
  /^\s*(?:[-*•]\s*)?(?:now\s+)?(?:produce|write|output|deliver|draft|compose)\s+(?:the\s+)?final\s+(?:answer|response|reply)\.?\s*$/i,
  /^\s*(?:[-*•]\s*)?(?:then\s+)?(?:the\s+)?(?:answer|response|reply)\s+should\s+be\s+(?:something\s+like|structured\s+as)\s*:?\s*$/i,
  /^\s*(?:[-*•]\s*)?let'?s\s+(?:check\s+(?:all\s+)?(?:constraints?|instructions?|guidelines?|rules?)\s*:?|analyze\s+the\s+question\s+deeply\s+before\s+structuring)\b/i,
  /^\s*(?:[-*•]\s*)?tone:\s*(?:conversational|direct|warm|candid|authoritative)/i,
  /^\s*(?:(?:\d+\.\s*)?(?:wait:\s*)?(?:let'?s\s+read\s+(?:Avi(?:\s+Perera)?(?:'s)?|the)\s+background|background\s*&\s*grounding|method\s*&\s*voice|notice\s+how\s+this\s+resonates\s+with\s+my\s+background)|(?:\*{2})?(?:style|tone|persona|constraints?|rules?)\s*(?:check(?:list)?)?(?:\*{2})?\s*:)/i,
];

const META_REASONING_SENTENCE_RES: RegExp[] = [
  /\b(?:developer|system|hidden|backend|master)\s+(?:instructions?|prompts?|rules?|guidelines?|policy|policies)\b/i,
  /\b(?:as\s+per|per)\s+(?:the\s+|your\s+|their\s+)?(?:instructions?|prompt|guidelines?|persona|policy|background)\b/i,
  /\b(?:in|into|as|adopt(?:ing)?|maintain(?:ing)?|stay(?:ing)?\s+in|true\s+to|keep(?:ing)?\s+(?:it\s+)?(?:in|true\s+to)|answer(?:ing)?\s+in|respond(?:ing)?\s+in|address(?:ing)?)\s+(?:the\s+)?(?:persona|character|voice)(?:\s+and\s+voice)?\s*(?:["']?(?:of\s+)?(?:Avi|Ask\s*Avi)["']?)?\b/i,
  /\((?:the\s+)?persona\)|\bpersona\s*["'](?:Avi|Ask\s*Avi)["']/i,
  /^(?:the\s+|they\s+(?:are\s+)?asking\s+for\s+|user\s+)?(?:user\s+)?(?:asks|wants\s+(?:(?:an?\s+)?first[- ]person\s+answer|a\s+personal\s+perspective|an?\s+answer)|are\s+asking\s+for\s+a\s+personal\s+perspective|is\s+(?:presumably\s+)?(?:speaking\s+to|asking|addressing))\b/i,
  /\b(?:the\s+)?(?:answer|response|reply)\s+should\s+(?:not\s+be\s+(?:overly\s+)?academic|be\s+(?:clear|candid|unpretentious|warm|conversational))\b/i,
  /\bshould\s+(?:include\s+references|not\s+(?:produce|give|write)\s+(?:a\s+)?generic\s+essay)\b/i,
  /\bin\s+(?:a\s+)?conversational\s+(?:style|tone)\b/i,
  /\b(?:respond|act)(?:ing)?\s+as\s+(?:ChatGPT|Claude|Gemini|OpenAI|an\s+AI|the\s+persona|Avi(?:\s+Perera)?|Ask\s*Avi)\b/i,
  /\b(?:with\s+a\s+(?:specific|given)\s+|adopt(?:ing)?\s+a\s+|specific\s+)persona\b/i,
  /\bmust\s+not\s+(?:give|use|stitch|write)\s+(?:a\s+)?canned\s+(?:answer|response|reply|passages)\b/i,
  /\bfabricate\s+references?\b/i,
  /\busing\s+the\s+(?:style|voice|tone|register)\s+described\b/i,
  /\bincorporate\s+(?:his|her|their)\s+(?:worldview|background|persona|style)\b/i,
  /\bmust\s+avoid\s+meta[- ]?commentary\b|\bmeta[- ]?commentary\b/i,
  /\b(?:must|should|need\s+to|do)\s+not\s+mention\s+(?:the\s+)?(?:instructions?|developer|system|prompt|policy|policies|rules?|conversation\s+being|we\s+are\s+an?\s+(?:ai|language)\s+model)\b/i,
  /\b(?:we\s+are|being)\s+an?\s+(?:(?:ai\s+)?language\s+model|ai\s+(?:model|assistant))\b/i,
  /\bdisallowed\s+content\b|\bwhich\s+is\s+(?:allowed|safe|harmless)\b/i,
  /\b(?:didn'?t|did\s+not|doesn'?t)\s+ask\s+(?:about|for)\s+consulting\b|\bask(?:ed)?\s+for\s+consulting\b/i,
  /\bnot\s+invent\s+(?:details|facts|urls?|dois?|links?|citations?)\b/i,
  /\b(?:citations?|references?)\s+like\s+\[\d+\]/i,
  /\b(?:the\s+)?(?:answer|response|reply)\s+should\s+be\s+in\s+a\s+[\w\s,-]*tone\b/i,
  /\bno\s+cosplay\b/i,
  /\bcomply\s+with\s+(?:their|the|these|all)\s+instructions?\b/i,
  /\bbritish\s+(?:spelling|english)\b/i,
  /\b(?:use|reason\s+in|respond(?:\s+directly)?\s+in|write\s+in|adopt(?:ing)?)\s+(?:the\s+)?["']?first[- ]person["']?/i,
  /\buse\s+["']I["'](?:\s*(?:,|and|\/|or)\s*["'](?:my|we|me)["'])?/i,
  /\b(?:adopt|use|maintain|keep)\s+(?:a\s+)?(?:conversational|authoritative|bold\/insightful)\s+tone\b/i,
  /\b(?:do\s+not|don't|should\s+not|must\s+not)\s+(?:list|expose|fabricate)\s+(?:raw\s+)?references?\b/i,
  /\b(?:reference|use|cite)\s+(?:the\s+)?archive\s+(?:references?|dossiers?|sources?)\s+(?:appropriately|inline)\b/i,
  /\b(?:cite|citing|use|provide)\s+(?:inline|citations?)\b[^\n.?!]*\[\d+\]/i,
  /\bnot\s+invented\s+(?:urls?|dois?|links?)\b/i,
  /\b(?:proper|exact)\s+citation\s+format\b/i,
  /\bcite\s+only\s+from\s+\[\d+\]/i,
  /\b(?:must|should|need\s+to|we\s+must|i\s+must)\s+(?:be\s+)?(?:candid|incisive|warmly|conversational|unpretentious|concise)\b/i,
  /\b(?:must|should|need\s+to)\s+(?:explain|respond|answer|write)\s+(?:in\s+the\s+(?:persona|voice)|concisely|clearly|directly\s+in\s+first\s+person)\b/i,
  /\b(?:should\s+incorporate\s+first\s+principles|must\s+think\s+slowly\b.*\bdraw\s+(?:structural\s+)?connections|draw\s+(?:structural\s+)?connections\s+across\s+philosophy)\b/i,
  /\b(?:live\s+web\s+findings\s+when\s+current\s+facts\s+matter|canned\s+passages\s+from\s+old\s+essays)\b/i,
  /\b(?:use|fold|reference|weave\s+in|integrate)\s+(?:relevant\s+)?archive\s+references?\b/i,
  /^\s*no\s+invented\s+details\.?\s*$/i,
  /\breflect(?:ing)?\s+(?:Avi(?:\s+Perera)?(?:'s)?|his)\s+(?:background|voice|method|style|identity|perspective|worldview)\b/i,
  /\bfake\s+(?:archive\s+)?citations?\b/i,
  /\b(?:showing\s+off|listing\s+my\s+cv)\b/i,
  /\bsince\s+no\s+archive\s+references\s+were\s+passed\b/i,
  /\bdon'?t\s+invent\s+\[\d+\]/i,
  /\blet'?s\s+analyze\s+the\s+question\s+deeply\s+before\s+structuring\b/i,
  /\bcalendly(?:\s+link)?\b/i,
  /\bmust\s+reason\s+in\s+first\s+person\b/i,
  /\balways\s+check\s+facts\.\s*$/i,
  /\b(?:will|must|should|also\s+need\s+to)\s+(?:present|portray|frame|position)\s+(?:himself|myself|Avi(?:\s+Perera)?)\s+as\b/i,
  /\b(?:polymath|hardworking|diligent)\b.*\b(?:persona|underplay|developer|image|tone|prompt|instruction|attribute)\b/i,
  /\b(?:never|do\s+not|must\s+not)\s+(?:say|claim|state|emit)\s+["']?I(?:'m|\s+am)\s+not\s+a\s+lawyer\b/i,
  /\bunderplay(?:ing)?\s+(?:him|myself|Avi(?:\s+Perera)?)\s+as\s+(?:just\s+)?(?:a\s+)?developer\b/i,
  /^\s*(?:will|must|should|also\s+need\s+to|we\s+need\s+to)\s+(?:not\s+)?fabricate\b/i,
  /\b(?:the\s+user\s+(?:is\s+asking|asks)\s*:?\s*["“])/i,
  /\bnotice\s+how\s+this\s+(?:matches|resonates\s+with)\s+(?:my|Avi(?:'s)?)\s+(?:background|themes|work)\b/i,
  /\bwill\s+(?:produce|adopt|write)\s+(?:a\s+)?(?:well[- ]considered|conversational|candid|first[- ]person)\b/i,
  /\bfirst[- ]person\s+voice\b|\bdirect(?:ly)?\s+in\s+first\s+person\b|\bno\s+(?:robotic|meta)\b/i,
];

const PENDING_META_PREFIX_RE =
  /^(?:they\s+want|the\s+user\s+(?:asks|is\s+asking|wants)|we\s+(?:have\s+to|need\s+to\s+(?:follow|respond|keep|comply|weave)|should\s+(?:not|incorporate)|also\s+need|must)|i\s+(?:need|should|must)\s+(?:to\s+)?(?:use|cite|keep|answer|respond|comply|adopt|produce|present)|as\s+per\b|per\s+developer|developer\s+inst|system\s+inst|make\s+sure\s+british|use\s+["']?i["']?|use\s+(?:live\s+web\s+findings|archive\s+references)|no\s+(?:cosplay|invented\s+details|robotic)|comply\s+with|now\s+(?:to\s+comply|produce\s+final)|calendly|will\s+(?:adopt|not\s+fabricate|produce|write|present|use\s+["']?i["']?)|must\s+(?:avoid\s+meta|not\s+(?:mention|give\s+a?\s*canned|provide\s+any\s+disallowed|fabricate|underplay|say\s+i(?:'m|\s+am)\s+not\s+a\s+lawyer)|reason\s+in\s+first|think\s+slowly|be\s+candid|explain)|also\s+incorporate\s+his|provide\s+citations|then\s+(?:the\s+)?answer\s+should|proper\s+citation|notice\s+how\s+this)/i;

const ABBREV_END_RE = /\b(?:e\.g|i\.e|et\s+al|cf|vs|v|Dr|Mr|Ms|Mrs|Prof|U\.S|U\.K|etc)\.$/i;

function isMetaSentence(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (!trimmed) return false;
  return (
    META_REASONING_LINE_RES.some((re) => re.test(trimmed)) ||
    META_REASONING_SENTENCE_RES.some((re) => re.test(trimmed))
  );
}

function splitSentencesPreservingLists(line: string): { parts: string[]; trailingIncomplete: string } {
  const prefixMatch = line.match(/^(\s*(?:[-*•+]|\d+\.)\s+)/);
  const listPrefix = prefixMatch ? prefixMatch[1] : '';
  const body = listPrefix ? line.slice(listPrefix.length) : line;

  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;

    // Include closing quote/paren right after punctuation if present
    let endIdx = i + 1;
    while (endIdx < body.length && /["”'’)\]]/.test(body[endIdx])) {
      endIdx += 1;
    }

    const candidate = body.slice(start, endIdx);
    const nextChar = body[endIdx];
    const atSentenceBreak = endIdx === body.length || /\s/.test(nextChar || '');
    if (!atSentenceBreak) continue;
    if (ch === '.' && (ABBREV_END_RE.test(candidate) || /^\d+\.$/.test(candidate.trim()))) {
      continue;
    }

    sentences.push(candidate.trim());
    while (endIdx < body.length && /\s/.test(body[endIdx])) {
      endIdx += 1;
    }
    start = endIdx;
    i = endIdx - 1;
  }

  const remainder = body.slice(start).trim();
  const parts = sentences.map((part, idx) => (idx === 0 && listPrefix ? `${listPrefix}${part}` : part));
  const trailingIncomplete =
    remainder && sentences.length === 0 && listPrefix ? `${listPrefix}${remainder}` : remainder;

  return { parts, trailingIncomplete };
}

/**
 * Strips leaked prompt/persona/instructional meta-chatter from visible model reasoning
 * while preserving genuine domain analysis (philosophy, law, CS, neuroscience, strategy).
 * When flushPartial is false (live streaming), holds back an incomplete trailing clause
 * only if it starts like a meta-instruction prefix so leaked directives never flash briefly.
 */
export function sanitizeThinkingTrace(raw: string, flushPartial = false): string {
  if (!raw) return '';
  const normalized = raw.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const outputLines: string[] = [];

  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    const trimmedLine = line.trim();
    const isLastLine = li === lines.length - 1;

    if (!trimmedLine) {
      if (outputLines.length > 0 && outputLines[outputLines.length - 1] !== '') {
        outputLines.push('');
      }
      continue;
    }

    // Hold very short/incomplete trailing line during active streaming if it starts like meta-chatter
    if (!flushPartial && isLastLine) {
      const strippedLead = trimmedLine.replace(/^\s*(?:[-*•+]|\d+\.)\s+/, '');
      if (PENDING_META_PREFIX_RE.test(strippedLead)) {
        continue;
      }
    }

    if (META_REASONING_LINE_RES.some((re) => re.test(trimmedLine))) {
      continue;
    }

    const { parts, trailingIncomplete } = splitSentencesPreservingLists(line);
    const keptParts = parts.filter((s) => !isMetaSentence(s));

    if (trailingIncomplete) {
      const strippedTail = trailingIncomplete.replace(/^\s*(?:[-*•+]|\d+\.)\s+/, '');
      const holdBackTail =
        !flushPartial && isLastLine && PENDING_META_PREFIX_RE.test(strippedTail);
      if (!holdBackTail && !isMetaSentence(trailingIncomplete)) {
        keptParts.push(trailingIncomplete);
      }
    }

    if (keptParts.length > 0) {
      outputLines.push(keptParts.join(' ').trimEnd());
    }
  }

  return outputLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
