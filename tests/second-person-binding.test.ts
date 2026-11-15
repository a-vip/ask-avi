import { describe, expect, it } from 'vitest';
import {
  buildPass1PlanMessages,
  buildPass2ExploreMessages,
  buildPass3CritiqueMessages,
  buildFinalContinuityBrief,
} from '../src/engine/deliberation';
import { knowledgeIndex } from '../src/engine/rag';
import {
  buildAviSystemPrompt,
} from '../src/data/persona';
import {
  alignCitedSources,
  mergeCandidateSources,
} from '../src/engine/citations';
import {
  assembleServerSystemPrompt,
  DEFAULT_SERVER_MASTER_PROMPT,
} from '../shared/masterPrompt';

describe('Second-person ("you"/"your") binding to Avi Perera', () => {
  it('binds second-person questions to Avi Perera across Pass 1, 2, 3, and Turn 1 continuity', () => {
    const pass1 = buildPass1PlanMessages({
      query: 'what religion do you follow?',
      history: [],
    });
    expect(pass1[0].content).toContain('Avi Perera personally');
    expect(pass1[0].content).toContain('NEVER rewrite "you" as "the AI"');

    const dummyPlan = {
      coreQuestion: 'What religious beliefs or philosophical worldview does Avi Perera hold?',
      conversationShift: 'initial' as const,
      priorCommitments: '',
      angles: ['Avi Perera documented reflections', 'First-principles philosophy'],
      archiveQueries: ['buddhist belief philosophy'],
      webQueries: [],
    };

    const pass2 = buildPass2ExploreMessages({
      plan: dummyPlan,
      query: 'what religion do you follow?',
      history: [],
      candidatePoolBlock: '',
    });
    expect(pass2[0].content).toContain('in the first person ("I", "my") as Avi Perera');
    expect(pass2[0].content).toContain('generic AI-assistant disclaimers');
    expect(pass2[0].content).not.toContain('Stage 1');

    const pass3 = buildPass3CritiqueMessages({
      plan: dummyPlan,
      query: 'what religion do you follow?',
      history: [],
      round2Analysis: 'Test exploration',
      candidatePoolBlock: '',
    });
    expect(pass3[0].content).toContain('first person ("I", "my") as Avi Perera');
    expect(pass3[0].content).toContain('generic AI/language-model disclaimers');

    const turn1Brief = buildFinalContinuityBrief({
      plan: dummyPlan,
      isFollowUp: false,
      round2Analysis: 'Test exploration',
      round3Critique: 'Test critique',
      hasCandidates: false,
    });
    expect(turn1Brief.continuityBrief).toContain('first person ("I", "my") directly as Avi Perera');
    expect(turn1Brief.continuityBrief).toContain('every visitor "you" or "your" addresses Avi Perera personally');
  });

  it('binds server master prompt, deliberate prompt, and fallback prompt consistently', () => {
    expect(DEFAULT_SERVER_MASTER_PROMPT).toContain('Every visitor "you" or "your" addresses me personally');
    expect(DEFAULT_SERVER_MASTER_PROMPT).toContain('never break frame into an AI assistant');

    const deliberatePrompt = assembleServerSystemPrompt({
      voiceStyle: 'standard',
      archiveBlock: '',
      webContext: '',
      attachedContext: '',
      isAuthenticated: false,
      phase: 'deliberate',
    });
    expect(deliberatePrompt).toContain('pure domain analysis');
    expect(deliberatePrompt).toContain('Avi Perera personally, never an AI assistant or language model');
    expect(deliberatePrompt).not.toContain('REGISTER:');

    const fallbackPrompt = buildAviSystemPrompt('standard', [], '', false);
    expect(fallbackPrompt).toContain('every visitor "you" or "your" asks about Avi Perera personally');
  });

  it('retrieves relevant personal writings via RAG query expansions for personal "you" queries', () => {
    const religionHits = knowledgeIndex.search('what religion do you follow?', { topK: 4 });
    const ids = religionHits.sources.map((s) => s.entry.id);
    expect(ids).toContain('doc-astrology-is-prejudice');

    const studyHits = knowledgeIndex.search('where did you study?', { topK: 4 });
    expect(studyHits.sources.map((s) => s.entry.id)).toContain('pillar-bio-identity');
  });

  it('strips out-of-range hallucinated [n] citation pills while keeping valid ones and code literals intact', () => {
    const candidates = mergeCandidateSources(
      [
        {
          index: 1,
          score: 12,
          snippet: 'Frame of reference leans slightly Buddhist.',
          matchedTerms: ['buddhist'],
          entry: {
            id: 'doc-astrology-is-prejudice',
            title: 'Why Astrology Is a Form of Prejudice',
            category: 'Essays & Philosophy',
            date: '2026-10-01',
            url: 'https://aviperera.com/astrology-is-prejudice/',
            doi: '',
            keywords: ['astrology', 'buddhist'],
            summary: 'Evidence over belief systems.',
            chunks: [],
          },
        },
      ],
      []
    );

    const aligned = alignCitedSources(
      'My frame of reference leans slightly Buddhist [1], never formal dogma\u202F[2]. See also `items[2]` and [link](https://example.com).',
      candidates
    );

    expect(aligned.sources).toHaveLength(1);
    expect(aligned.content).toContain('[1], never formal dogma.');
    expect(aligned.content).not.toContain('dogma\u202F[2]');
    expect(aligned.content).toContain('`items[2]`');
    expect(aligned.content).toContain('[link](https://example.com)');
  });
});
