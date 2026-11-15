import { useCallback, useRef, useState } from 'react';

/** State with a bounded undo stack. Edits are recorded per call to `set`. */
export function useUndoable<T>(initial: T, limit = 50) {
  const [value, setValue] = useState<T>(initial);
  const history = useRef<T[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const set = useCallback((next: T) => {
    setValue((prev) => {
      history.current.push(prev);
      if (history.current.length > limit) history.current.shift();
      return next;
    });
    setCanUndo(true);
  }, [limit]);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (prev === undefined) return;
    setValue(prev);
    setCanUndo(history.current.length > 0);
  }, []);

  return { value, set, undo, canUndo };
}
