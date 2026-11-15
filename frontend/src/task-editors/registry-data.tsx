import type { EditorDefinition } from './registry';
import { TranscriptionEditor } from './transcription/TranscriptionEditor';
import { validateTranscription } from './transcription/validate';
import { CallScorecardEditor, validateCallScorecard } from './call-scorecard/CallScorecardEditor';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const definitions: EditorDefinition<any, any>[] = [
  {
    taskType: 'TRANSCRIPTION',
    schemaVersion: 1,
    label: 'Call transcription',
    Editor: TranscriptionEditor,
    validateForSubmit: validateTranscription,
  },
  {
    taskType: 'CALL_SCORECARD',
    schemaVersion: 1,
    label: 'QA scorecard',
    Editor: CallScorecardEditor,
    validateForSubmit: validateCallScorecard,
  },
];

/**
 * Resolves the editor for (taskType, schemaVersion). Adding a task type = one entry here + one backend
 * TaskTypeDefinition; the lifecycle (autosave, submit, review, audit) is shared.
 */
export function resolveEditor(taskType: string, schemaVersion: number) {
  return definitions.find((d) => d.taskType === taskType && d.schemaVersion === schemaVersion);
}

export function taskTypeLabel(taskType: string): string {
  return definitions.find((d) => d.taskType === taskType)?.label ?? taskType;
}
