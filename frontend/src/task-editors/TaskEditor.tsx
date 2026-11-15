import { resolveEditor } from './registry-data';

interface Props {
  taskType: string;
  schemaVersion: number;
  payload: unknown;
  input: unknown;
  readOnly: boolean;
  onChange: (next: unknown) => void;
  errors?: readonly string[];
  draft?: import('../shared/types').DraftView | null;
}

export function TaskEditor({ taskType, schemaVersion, payload, input, readOnly, onChange, errors = [], draft = null }: Props) {
  const def = resolveEditor(taskType, schemaVersion);
  if (!def) {
    return (
      <p role="alert" className="error">
        Unsupported task type {taskType} (schema v{schemaVersion}). Ask an admin to upgrade the client.
      </p>
    );
  }
  const { Editor } = def;
  return <Editor payload={payload} input={input} readOnly={readOnly} onChange={onChange} errors={errors} draft={draft} />;
}
