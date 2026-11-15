export interface CotSeparationResult {
  extractedThinking: string;
  cleanAnswer: string;
  isHoldingBack: boolean;
}

const STREAM_OPENING_PREFIXES = [
  '<thought',
  '<think',
  '<thinking',
  '<reasoning',
  '<internal_thought',
  '<|thought',
  '<|channel',
  '<|start|>',
  'thinking process',
  'thought process',
  'internal reasoning',
  'internal monologue',
  'chain of thought',
  'reasoning process',
  '1. analyze the request',
  '1. analyse the request',
  '1. **analyze',
  '1. **analyse',
  'analyze the request',
  'analyse the request',
  '1. deconstruct',
  '1. **deconstruct',
  'deconstruction:',
  'drafting response',
  'drafting the response',
];

const COT_UNAMBIGUOUS_OPENER_RE =
  /^(?:thinking\s+process|thought\s+process|internal\s+reasoning|internal\s+monologue|chain\s+of\s+thought|reasoning\s+process|scratchpad)\b/i;

const COT_META_STAGE_RE =
  /^(?:analy(?:[sz]e|sis)\s+(?:the\s+)?(?:request|prompt|question|query|input)|request\s+analysis|prompt\s+analysis|query\s+analysis|deconstruct(?:ion|ing)?(?:\s+(?:the\s+)?(?:request|prompt|question|query))?|drafting(?:\s+(?:the\s+)?(?:response|reply|answer))?|initial\s+draft|response\s+draft|review(?:\s+against)?\s+(?:the\s+)?(?:constraints|instructions|guidelines|prompt|criteria)|constraint\s+(?:check|verification)|verification\s+against\s+(?:constraints|instructions)|self[- ]corrections?|self[- ]critique|self[- ]check|revised\s+plan|refinement\s+plan|refinement(?:\s+(?:and|&)\s+(?:structure|polishing|polish|tone))?|final\s+polish|polishing(?:\s+(?:the\s+)?(?:response|reply|output))?|structure\s*(?:&|and)\s*polishing?)\b/i;

const COT_GENERIC_SUBSTAGE_RE =
  /^(?:analysis|deconstruction|reasoning|understanding|context(?:\s+&\s+constraints)?|tone\s*(?:&|and)\s*style|style\s*(?:&|and)\s*tone|structure(?:\s*(?:&|and)\s*flow)?|outline|plan|strategy|goal|intent|key\s+(?:themes|points|ideas|concepts|takeaways)|citations?\s*(?:&|and)?\s*links?|links?\s*(?:&|and)?\s*citations?|constraints?|formatting|verification|refinement|polishing|check)\b/i;

const FINAL_HANDOFF_MARKER_RE =
  /^(?:final\s+(?:output|response|answer)|actual\s+(?:output|response|answer)|response\s+to\s+(?:the\s+)?user|output\s+to\s+(?:the\s+)?user)\s*:?\s*(.*)$/i;

const TRAILING_HOLD_PREFIX_RE =
  /(?:\r?\n){1,2}(?:#{1,6}\s*|\*{1,3}|[-*+]\s*|\d+[.)]\s*)*(?:thinking\s*process|review(?:\s+against)?|constraint|self[- ]correction|self[- ]critique|revised\s+plan|final\s+polish|refinement|polishing|drafting\s+(?:the\s+)?response)[^\n]*$/i;

const INLINE_META_PARAGRAPH_START_RE =
  /^\s*(?:\*{1,3}|_{1,2}|#{1,6}\s*|\d+[.)]\s*)*(?:thinking\s+process|thought\s+process|internal\s+reasoning|self[- ]corrections?|self[- ]critique|review(?:\s+against)?\s+(?:the\s+)?constraints|constraint\s+(?:check|verification)|revised\s+plan|final\s+polish|refinement\s+(?:and|&)\s+(?:structure|polishing)|drafting\s+(?:the\s+)?response)\s*:?\s*(?:\*{1,3}|_{1,2})?(?:\s|:|$)/i;

const TAG_PAIR_SPECS: Array<{ open: RegExp; close: RegExp }> = [
  {
    open: /<\|\s*channel\s*\|?\s*>\s*(?:thought|analysis|reasoning)\b/i,
    close: /<\|\s*channel\s*\|?\s*>\s*(?:response|final|answer)\b|<\s*channel\s*\|\s*>/i,
  },
  { open: /<\|\s*thought\s*\|>/i, close: /<\|\s*(?:\/|end_)?thought\s*\|>/i },
  { open: /<\s*(thought|think|thinking|reasoning|internal_thought)\b[^>]*>/i, close: /<\/\s*(?:thought|think|thinking|reasoning|internal_thought)\s*>/i },
];

function stripHeadingWrapper(rawLine: string): {
  stripped: string;
  isIndented: boolean;
  isBullet: boolean;
  isNumbered: boolean;
  isRule: boolean;
} {
  const isIndented = /^(?: {2,}|\t)/.test(rawLine);
  const trimmed = rawLine.trim();
  const isRule = /^([-*_])\1{2,}$/.test(trimmed);
  let body = trimmed.replace(/^#{1,6}\s+/, '');
  const bulletMatch = body.match(/^[-*+]\s+(.*)$/);
  const isBullet = Boolean(bulletMatch);
  if (bulletMatch) body = bulletMatch[1];
  const numMatch = body.match(/^\d+[.)]\s+(.*)$/);
  const isNumbered = Boolean(numMatch);
  if (numMatch) body = numMatch[1];
  body = body.replace(/^[*_`]+/, '').replace(/[*_`]+$/, '').trim();
  const stripped = body.replace(/:+$/, '').replace(/[*_`]+$/, '').trim();
  return { stripped, isIndented, isBullet, isNumbered, isRule };
}

function isFencedToggle(line: string): boolean {
  return /^\s*```/.test(line);
}

function isPotentialOpeningPrefix(raw: string): boolean {
  const normalized = raw
    .trimStart()
    .toLowerCase()
    .replace(/^#{1,6}\s*/, '')
    .replace(/[*_`]+/g, '');
  if (!normalized || normalized.length > 48 || normalized.includes('\n')) return false;
  return STREAM_OPENING_PREFIXES.some(
    (prefix) =>
      prefix.startsWith(normalized) ||
      (normalized.startsWith(prefix.slice(0, 12)) && prefix.includes(normalized))
  );
}

/**
 * Extracts explicit inline thought tags (<thought>, <think>, <|thought|>, <|channel>thought, etc.)
 * outside fenced code blocks, even when structured reasoning deltas already exist.
 */
function extractTagBlocks(input: string): {
  extracted: string[];
  remaining: string;
  hasUnclosedTag: boolean;
} {
  const extracted: string[] = [];
  let cursor = input;
  let hasUnclosedTag = false;

  // Iterate until no more non-code-fenced opening tags remain
  for (let pass = 0; pass < 16; pass++) {
    let earliestIdx = -1;
    let earliestSpec: (typeof TAG_PAIR_SPECS)[number] | null = null;
    let openLen = 0;

    // Mask fenced code regions when searching for opening tags
    const masked = cursor.replace(/```[\s\S]*?```/g, (block) => ' '.repeat(block.length));

    for (const spec of TAG_PAIR_SPECS) {
      const m = masked.match(spec.open);
      if (m && m.index !== undefined && (earliestIdx === -1 || m.index < earliestIdx)) {
        earliestIdx = m.index;
        earliestSpec = spec;
        openLen = m[0].length;
      }
    }

    if (earliestIdx === -1 || !earliestSpec) break;

    const afterOpen = cursor.slice(earliestIdx + openLen);
    const closeMatch = afterOpen.match(earliestSpec.close);
    if (closeMatch && closeMatch.index !== undefined) {
      const inner = afterOpen.slice(0, closeMatch.index).trim();
      if (inner) extracted.push(inner);
      cursor = cursor.slice(0, earliestIdx) + '\n' + afterOpen.slice(closeMatch.index + closeMatch[0].length);
    } else {
      const inner = afterOpen.trim();
      if (inner) extracted.push(inner);
      cursor = cursor.slice(0, earliestIdx);
      hasUnclosedTag = true;
      break;
    }
  }

  // Remove any dangling closing/channel tokens outside code blocks
  cursor = cursor
    .split(/(```[\s\S]*?```)/g)
    .map((segment, idx) =>
      idx % 2 === 1
        ? segment
        : segment
            .replace(/<\/\s*(?:thought|think|thinking|reasoning|internal_thought)\s*>/gi, '')
            .replace(/<\|\s*(?:\/|end_)?thought\s*\|>/gi, '')
            .replace(/<\|\s*channel\s*\|?\s*>\s*(?:response|final|answer)\b/gi, '')
            .replace(/<\s*channel\s*\|\s*>/gi, '')
            .replace(/<\|\s*(?:end|return|eot_id|im_end)\s*\|?>/gi, '')
    )
    .join('');

  return { extracted, remaining: cursor.trimStart(), hasUnclosedTag };
}

function splitFinalHandoffMarker(text: string): { before: string; after: string } | null {
  const lines = text.split('\n');
  let inFence = false;
  let lastHandoffLine = -1;
  let handoffRemainder = '';

  for (let i = 0; i < lines.length; i++) {
    if (isFencedToggle(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const { stripped, isIndented } = stripHeadingWrapper(lines[i]);
    if (isIndented) continue;
    const rawNoMd = lines[i]
      .trim()
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/^[*_`]+|[*_`]+$/g, '')
      .trim();
    const m = rawNoMd.match(FINAL_HANDOFF_MARKER_RE) ?? stripped.match(FINAL_HANDOFF_MARKER_RE);
    if (m) {
      lastHandoffLine = i;
      handoffRemainder = (m[1] ?? '').replace(/^[*_`:\s]+/, '').trim();
    }
  }

  if (lastHandoffLine === -1) return null;
  const before = lines.slice(0, lastHandoffLine).join('\n').trim();
  const tailLines = lines.slice(lastHandoffLine + 1);
  const after = [handoffRemainder, ...tailLines].filter(Boolean).join('\n').trim();
  return { before, after };
}

/**
 * Separates untagged chain-of-thought preambles ("Thinking Process:", "1. Analyze the Request",
 * "Deconstruction", "Drafting Response", "Refinement", "Review against constraints",
 * "Self-Correction", "Revised Plan", "Final Polish") and trailing critique/polish sections
 * from the visible user-facing answer.
 */
export function separateLeakedCotFromAnswer(
  rawInput: string,
  options: { flushPartial?: boolean } = {}
): CotSeparationResult {
  const flushPartial = options.flushPartial ?? true;
  if (!rawInput) {
    return { extractedThinking: '', cleanAnswer: '', isHoldingBack: false };
  }

  const tagResult = extractTagBlocks(rawInput);
  const extractedParts = [...tagResult.extracted];
  let work = tagResult.remaining;

  if (tagResult.hasUnclosedTag && !flushPartial && !work.trim()) {
    return {
      extractedThinking: extractedParts.join('\n\n'),
      cleanAnswer: '',
      isHoldingBack: true,
    };
  }

  // While streaming, hold short ambiguous opening tokens before they flash "Thinking Process:"
  if (!flushPartial && isPotentialOpeningPrefix(work)) {
    return {
      extractedThinking: extractedParts.join('\n\n'),
      cleanAnswer: '',
      isHoldingBack: true,
    };
  }

  // Check if leading text begins with an unmistakable COT scaffold
  const leadingLines = work.split('\n');
  let firstNonEmptyIdx = -1;
  for (let i = 0; i < leadingLines.length; i++) {
    if (leadingLines[i].trim()) {
      firstNonEmptyIdx = i;
      break;
    }
  }

  if (firstNonEmptyIdx !== -1) {
    const firstHead = stripHeadingWrapper(leadingLines[firstNonEmptyIdx]);
    let secondHeadStripped = '';
    for (let s = firstNonEmptyIdx + 1; s < leadingLines.length && s <= firstNonEmptyIdx + 3; s++) {
      if (leadingLines[s].trim()) {
        secondHeadStripped = stripHeadingWrapper(leadingLines[s]).stripped;
        break;
      }
    }
    const startsWithCotOpener =
      COT_UNAMBIGUOUS_OPENER_RE.test(firstHead.stripped) ||
      COT_META_STAGE_RE.test(firstHead.stripped) ||
      (/^(?:thoughts?|reasoning|analysis|plan|outline|internal\s+notes?)$/i.test(firstHead.stripped) &&
        (COT_META_STAGE_RE.test(secondHeadStripped) || COT_UNAMBIGUOUS_OPENER_RE.test(secondHeadStripped)));

    if (startsWithCotOpener) {
      // Case 1: Explicit Final Output / Final Response handoff marker exists
      const handoff = splitFinalHandoffMarker(work);
      if (handoff) {
        if (handoff.before) extractedParts.push(handoff.before);
        work = handoff.after;
        if (!work && !flushPartial) {
          return {
            extractedThinking: extractedParts.join('\n\n'),
            cleanAnswer: '',
            isHoldingBack: true,
          };
        }
      } else {
        // Case 2: No explicit "Final Output:" marker; locate the end of the COT outline
        let inFence = false;
        let lastCotBoundaryLine = firstNonEmptyIdx;
        let inCotOutline = true;
        let seenClosingStage = COT_META_STAGE_RE.test(firstHead.stripped);

        for (let i = firstNonEmptyIdx + 1; i < leadingLines.length; i++) {
          const line = leadingLines[i];
          if (isFencedToggle(line)) {
            inFence = !inFence;
            if (inCotOutline) lastCotBoundaryLine = i;
            continue;
          }
          if (inFence) {
            if (inCotOutline) lastCotBoundaryLine = i;
            continue;
          }
          const trimmed = line.trim();
          if (!trimmed) continue;

          const parsed = stripHeadingWrapper(line);
          const isStageLine =
            COT_UNAMBIGUOUS_OPENER_RE.test(parsed.stripped) ||
            COT_META_STAGE_RE.test(parsed.stripped) ||
            COT_GENERIC_SUBSTAGE_RE.test(parsed.stripped);

          if (
            COT_META_STAGE_RE.test(parsed.stripped) &&
            /draft|refin|polish|review|constraint|self[- ]|revised/i.test(parsed.stripped)
          ) {
            seenClosingStage = true;
          }

          if (isStageLine && !parsed.isIndented) {
            lastCotBoundaryLine = i;
            continue;
          }

          if (
            parsed.isIndented ||
            parsed.isBullet ||
            parsed.isNumbered ||
            parsed.isRule ||
            /^(?:wait,|let'?s|let me|we should|i need to|i should|make sure|ensure|note:|check:)/i.test(
              trimmed.replace(/^[*_`]+/, '')
            )
          ) {
            lastCotBoundaryLine = i;
            continue;
          }

          // Check whether this unindented paragraph is merely a discarded scratchpad draft
          // inside the leading COT block — ONLY true if a late meta-stage follows AND
          // substantial non-checklist answer prose appears after that final meta-stage.
          let laterMetaIdx = -1;
          for (let j = i + 1; j < leadingLines.length; j++) {
            const p = stripHeadingWrapper(leadingLines[j]);
            if (
              !p.isIndented &&
              /^(?:review(?:\s+against)?\s+(?:the\s+)?constraints|constraint\s+(?:check|verification)|self[- ]corrections?|self[- ]critique|revised\s+plan|final\s+polish)\b/i.test(
                p.stripped
              )
            ) {
              laterMetaIdx = j;
            }
          }
          if (laterMetaIdx !== -1) {
            let sawBlankAfterMeta = false;
            let hasSubstantivePostMetaProse = false;
            for (let k = laterMetaIdx + 1; k < leadingLines.length; k++) {
              const postTrim = leadingLines[k].trim();
              if (!postTrim) {
                sawBlankAfterMeta = true;
                continue;
              }
              const postParsed = stripHeadingWrapper(leadingLines[k]);
              const isPostMetaChecklist =
                postParsed.isIndented ||
                postParsed.isBullet ||
                postParsed.isNumbered ||
                postParsed.isRule ||
                COT_META_STAGE_RE.test(postParsed.stripped) ||
                /^(?:done|ready|looks good|all checked|all good|good to go|checking|proceeding|keep it|wait,|let'?s)\b/i.test(
                  postTrim.replace(/^[*_`]+/, '')
                );
              if (!isPostMetaChecklist && sawBlankAfterMeta && postTrim.length >= 45) {
                hasSubstantivePostMetaProse = true;
                break;
              }
            }
            if (hasSubstantivePostMetaProse) {
              lastCotBoundaryLine = i;
              continue;
            }
          }

          // Consume immediate short status/check note right beneath a stage heading before blank break
          const prevNonBlankIsStage =
            i > firstNonEmptyIdx &&
            leadingLines[i - 1].trim() !== '' &&
            (COT_META_STAGE_RE.test(stripHeadingWrapper(leadingLines[i - 1]).stripped) ||
              /^(?:done|ready|looks good|all checked|all good|good to go|checking|proceeding)\b/i.test(
                trimmed.replace(/^[*_`]+/, '')
              ));
          if (prevNonBlankIsStage && trimmed.split(/\s+/).length <= 12) {
            lastCotBoundaryLine = i;
            continue;
          }

          // Transition cleanly into the real answer once past the leading COT block
          if (seenClosingStage || lastCotBoundaryLine > firstNonEmptyIdx) {
            inCotOutline = false;
            break;
          }
          lastCotBoundaryLine = i;
        }

        if (inCotOutline) {
          // Still entirely inside the leading COT scaffold
          if (work.trim()) extractedParts.push(work.trim());
          return {
            extractedThinking: extractedParts.join('\n\n'),
            cleanAnswer: '',
            isHoldingBack: !flushPartial,
          };
        }

        const cotPrefix = leadingLines
          .slice(0, lastCotBoundaryLine + 1)
          .join('\n')
          .replace(/(?:\n[-*_]{3,}\s*)+$/, '')
          .trim();
        if (cotPrefix) extractedParts.push(cotPrefix);
        work = leadingLines.slice(lastCotBoundaryLine + 1).join('\n').trimStart();
      }
    }
  }

  // Strip scattered/trailing meta-review blocks ("Review against constraints", "Self-Correction", "Revised Plan", "Final Polish")
  if (work.trim()) {
    const outLines: string[] = [];
    const lines = work.split('\n');
    let inFence = false;
    let strippingMetaSection = false;
    const strippedMetaBuffer: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isFencedToggle(line)) {
        inFence = !inFence;
        if (strippingMetaSection) strippedMetaBuffer.push(line);
        else outLines.push(line);
        continue;
      }
      if (inFence) {
        if (strippingMetaSection) strippedMetaBuffer.push(line);
        else outLines.push(line);
        continue;
      }

      const trimmed = line.trim();
      const parsed = stripHeadingWrapper(line);
      const isExplicitMetaHeader =
        !parsed.isIndented &&
        (INLINE_META_PARAGRAPH_START_RE.test(trimmed) || COT_META_STAGE_RE.test(parsed.stripped));

      if (isExplicitMetaHeader) {
        // Trim any divider right before the meta-review block
        while (outLines.length > 0 && /^[-*_]{3,}$/.test(outLines[outLines.length - 1].trim())) {
          outLines.pop();
        }
        strippingMetaSection = true;
        strippedMetaBuffer.push(line);
        continue;
      }

      if (strippingMetaSection) {
        // An explicit Final Output/Response marker inside or after a critique resumes clean output
        const rawNoMd = trimmed
          .replace(/^#{1,6}\s+/, '')
          .replace(/^[-*+]\s+/, '')
          .replace(/^\d+[.)]\s+/, '')
          .replace(/^[*_`]+|[*_`]+$/g, '')
          .trim();
        const handoff = rawNoMd.match(FINAL_HANDOFF_MARKER_RE);
        if (handoff) {
          strippingMetaSection = false;
          if (strippedMetaBuffer.length > 0) {
            extractedParts.push(strippedMetaBuffer.join('\n').trim());
            strippedMetaBuffer.length = 0;
          }
          if (handoff[1]?.trim()) {
            outLines.push(handoff[1].trim());
          }
          continue;
        }

        // Continue skipping blank lines, horizontal rules, indented/bulleted checklists, and meta self-talk
        if (
          !trimmed ||
          parsed.isIndented ||
          parsed.isBullet ||
          parsed.isNumbered ||
          parsed.isRule ||
          /^(?:wait,|let'?s|let me|i should|we should|need to|check:|all constraints|british spelling|tone:|word count)/i.test(
            trimmed.replace(/^[*_`]+/, '')
          )
        ) {
          strippedMetaBuffer.push(line);
          continue;
        }

        // Unindented continuation paragraph right under *Self-Correction:* if we're near the end or another meta block follows
        const tailText = lines.slice(i + 1).join('\n');
        if (!tailText.trim() || INLINE_META_PARAGRAPH_START_RE.test(tailText)) {
          strippedMetaBuffer.push(line);
          continue;
        }

        // Otherwise genuine prose resumed
        strippingMetaSection = false;
        if (strippedMetaBuffer.length > 0) {
          extractedParts.push(strippedMetaBuffer.join('\n').trim());
          strippedMetaBuffer.length = 0;
        }
        outLines.push(line);
        continue;
      }

      outLines.push(line);
    }

    if (strippedMetaBuffer.length > 0) {
      extractedParts.push(strippedMetaBuffer.join('\n').trim());
    }
    work = outLines.join('\n').replace(/^\s+|\s+$/g, '');
  }

  // While streaming, withhold an incomplete trailing line if it starts like a meta-review header
  if (!flushPartial && work) {
    const trailingMatch = work.match(TRAILING_HOLD_PREFIX_RE);
    if (trailingMatch && trailingMatch.index !== undefined) {
      work = work.slice(0, trailingMatch.index).trimEnd();
    }
  }

  return {
    extractedThinking: extractedParts.filter(Boolean).join('\n\n'),
    cleanAnswer: work.trim(),
    isHoldingBack: !flushPartial && !work.trim() && (extractedParts.length > 0 || tagResult.hasUnclosedTag),
  };
}
