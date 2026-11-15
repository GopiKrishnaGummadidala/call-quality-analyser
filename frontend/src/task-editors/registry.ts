import type { ComponentType } from 'react';

/** Contract between the generic annotation workspace and a task-specific editor. */
export interface EditorProps<P = unknown, I = unknown> {
  payload: P;
  input: I;
  onChange: (next: P) => void;
  readOnly: boolean;
  /**
   * Submit-validation messages to show on the fields they refer to. Empty until the user first tries to submit,
   * then kept current while they edit, so a field turns red when invalid and clears as soon as it is fixed.
   */
  errors?: readonly string[];
  /** The model's first draft when the task started from one (model-assisted annotation). */
  draft?: import('../shared/types').DraftView | null;
}

export interface EditorDefinition<P = unknown, I = unknown> {
  taskType: string;
  schemaVersion: number;
  label: string;
  Editor: ComponentType<EditorProps<P, I>>;
  validateForSubmit: (payload: P) => string[];
}
