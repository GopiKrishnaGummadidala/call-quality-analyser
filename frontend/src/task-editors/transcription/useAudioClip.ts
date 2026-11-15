import { useEffect, useState } from 'react';
import { fetchProtected } from '../../shared/api';

export interface AudioClip {
  /** Object URL for the <audio> element (in-memory, revoked on unmount); undefined while loading or on error. */
  src?: string;
  /** Normalised peak amplitudes (0..1) for the waveform, or null when not (yet) decoded. */
  peaks: number[] | null;
  status: 'loading' | 'ready' | 'error';
}

/**
 * Loads a task recording through the authenticated API (recordings are never public files), hands the
 * <audio> element an in-memory object URL, and decodes the same bytes once for the waveform.
 */
export function useAudioClip(url: string, bins: number): AudioClip {
  const [clip, setClip] = useState<AudioClip>({ peaks: null, status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setClip({ peaks: null, status: 'loading' });

    fetchProtected(url)
      .then(async (bytes) => {
        if (cancelled) return;
        if (typeof URL.createObjectURL === 'function') {
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        }
        setClip({ src: objectUrl, peaks: null, status: 'ready' });
        const peaks = await decodePeaks(bytes.slice(0), bins); // decodeAudioData detaches its input
        if (!cancelled && peaks) setClip((c) => ({ ...c, peaks }));
      })
      .catch(() => { if (!cancelled) setClip({ peaks: null, status: 'error' }); });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, bins]);

  return clip;
}

async function decodePeaks(bytes: ArrayBuffer, bins: number): Promise<number[] | null> {
  const Ctx: typeof AudioContext | undefined = typeof window !== 'undefined'
    ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    : undefined;
  if (!Ctx) return null;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(bytes);
    const data = audio.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / bins));
    const out: number[] = [];
    let max = 0;
    for (let b = 0; b < bins; b++) {
      let peak = 0;
      for (let i = b * size, end = Math.min(data.length, i + size); i < end; i++) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
      }
      out.push(peak);
      if (peak > max) max = peak;
    }
    return out.map((p) => (max > 0 ? p / max : 0));
  } catch {
    return null; // decoding unavailable: playback and the timeline still work
  } finally {
    void ctx.close().catch(() => undefined);
  }
}
