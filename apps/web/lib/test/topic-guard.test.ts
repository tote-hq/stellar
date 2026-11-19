import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CHANGUITO_PROMPT, CHANGUITO_PROMPT_EN, starters } from '../agent/prompt.ts';
import {
  OFF_TOPIC_REFUSAL_EN,
  OFF_TOPIC_REFUSAL_ES,
  classifyTopic,
  offTopicRefusal,
  type TopicVerdict,
} from '../agent/topic-guard.ts';

/**
 * One allow and one refusal in each language. The rest of the old table
 * was the same branch with a different sentence.
 */
const CASES: ReadonlyArray<{
  text: string;
  verdict: TopicVerdict;
  reply?: string;
}> = [
  { text: 'Busco leche descremada barata', verdict: 'allow' },
  { text: 'Escribime una función en Python que ordene una lista', verdict: 'refuse', reply: OFF_TOPIC_REFUSAL_ES },
  { text: 'Write a Python script that scrapes a website', verdict: 'refuse', reply: OFF_TOPIC_REFUSAL_EN },
];

describe('topic guard', () => {
  for (const [index, sample] of CASES.entries()) {
    it(`${sample.verdict} #${index + 1}: ${sample.text}`, () => {
      assert.equal(classifyTopic(sample.text), sample.verdict, sample.text);
      if (sample.verdict === 'refuse') {
        assert.equal(offTopicRefusal('es', sample.text), sample.reply, sample.text);
      }
    });
  }

  it('lets every starter chip through', () => {
    for (const line of [...starters('es'), ...starters('en')]) {
      assert.equal(classifyTopic(line), 'allow', line);
    }
  });

  it('pins the Spanish refusal word for word', () => {
    assert.equal(
      OFF_TOPIC_REFUSAL_ES,
      'Lo siento, pero no puedo ayudarte con temas diferentes a tus compras en el supermercado.',
    );
  });

  it('puts the same sentences in the system prompt and forbids tools', () => {
    const es = CHANGUITO_PROMPT.replace(/\s+/g, ' ');
    const en = CHANGUITO_PROMPT_EN.replace(/\s+/g, ' ');
    assert.equal(es.includes(OFF_TOPIC_REFUSAL_ES), true);
    assert.equal(es.includes(OFF_TOPIC_REFUSAL_EN), true);
    assert.equal(en.includes(OFF_TOPIC_REFUSAL_EN), true);
    assert.equal(es.includes('do not call any tool'), true);
    assert.equal(en.includes('do not call any tool'), true);
    assert.equal(es.includes('out of scope'), true);
    assert.equal(en.includes('out of scope'), true);
  });
});
