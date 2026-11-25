/**
 * What the composer may do while a turn is in flight.
 *
 * No imports: the chat tests load this file by stripping types.
 * The field stays editable so the next message can be drafted. Send stays
 * off until the turn ends, including Enter, which the caller already refuses
 * while `streaming` is true.
 */
export interface ComposerInput {
  streaming: boolean;
  gated: boolean;
  readOnly: boolean;
  readingPhoto: boolean;
  hasDraft: boolean;
}

export interface ComposerControls {
  inputDisabled: boolean;
  sendDisabled: boolean;
  showStop: boolean;
  hint: boolean;
}

export function composerControls(input: ComposerInput): ComposerControls {
  return {
    inputDisabled: input.gated || input.readOnly,
    sendDisabled:
      input.streaming || input.gated || input.readOnly || input.readingPhoto || !input.hasDraft,
    showStop: input.streaming && !input.readOnly,
    hint: input.streaming && !input.gated && !input.readOnly,
  };
}
