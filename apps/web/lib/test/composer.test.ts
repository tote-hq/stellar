import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { composerControls } from '../composer.ts';

describe('composer controls', () => {
  it('keeps the field editable and Send disabled while a turn is in flight', () => {
    const streaming = composerControls({
      streaming: true,
      gated: false,
      readOnly: false,
      readingPhoto: false,
      hasDraft: true,
    });
    assert.equal(streaming.inputDisabled, false);
    assert.equal(streaming.sendDisabled, true);
    assert.equal(streaming.showStop, true);
    assert.equal(streaming.hint, true);
  });

  it('enables Send when idle with a draft, and disables both when gated', () => {
    const idle = composerControls({
      streaming: false,
      gated: false,
      readOnly: false,
      readingPhoto: false,
      hasDraft: true,
    });
    assert.equal(idle.inputDisabled, false);
    assert.equal(idle.sendDisabled, false);
    assert.equal(idle.showStop, false);

    const gated = composerControls({
      streaming: false,
      gated: true,
      readOnly: false,
      readingPhoto: false,
      hasDraft: true,
    });
    assert.equal(gated.inputDisabled, true);
    assert.equal(gated.sendDisabled, true);
  });
});
