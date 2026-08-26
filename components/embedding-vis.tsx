"use client";

import { useMemo } from "react";

import { Label } from "./ui";

/**
 * Renders a 1024-dimensional unit vector as a dense bar field.
 *
 * The point is not to read individual dimensions — it is to show that two
 * clips of the same utterance produce visibly the same shape, and that the
 * vector is dense rather than sparse.
 */
export function EmbeddingVis({ vector, tone }: { vector: number[]; tone: string }) {
  const { bars, max } = useMemo(() => {
    const bucketCount = 128;
    const size = Math.ceil(vector.length / bucketCount);
    const bars: number[] = [];
    for (let i = 0; i < vector.length; i += size) {
      const slice = vector.slice(i, i + size);
      bars.push(slice.reduce((sum, value) => sum + value, 0) / slice.length);
    }
    return { bars, max: Math.max(...bars.map(Math.abs)) || 1 };
  }, [vector]);

  return (
    <div className="flex h-20 items-center gap-px">
      {bars.map((value, index) => {
        const height = Math.max(2, (Math.abs(value) / max) * 100);
        return (
          <div key={index} className="flex h-full flex-1 flex-col justify-center">
            <div
              style={{
                height: `${height / 2}%`,
                background: tone,
                opacity: value >= 0 ? 0.9 : 0.35,
                marginTop: value >= 0 ? "auto" : 0,
              }}
              className="rounded-[1px]"
            />
          </div>
        );
      })}
    </div>
  );
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denominator = Math.sqrt(na) * Math.sqrt(nb);
  return denominator ? dot / denominator : 0;
}

export function VectorStats({ vector }: { vector: number[] }) {
  const stats = useMemo(() => {
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    const mean = vector.reduce((sum, value) => sum + value, 0) / vector.length;
    const sparse = vector.filter((value) => Math.abs(value) < 1e-4).length;
    return {
      norm,
      mean,
      min: Math.min(...vector),
      max: Math.max(...vector),
      sparsity: sparse / vector.length,
    };
  }, [vector]);

  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-2 sm:grid-cols-4">
      {[
        ["L2 norm", stats.norm.toFixed(4)],
        ["mean", stats.mean.toExponential(2)],
        ["range", `${stats.min.toFixed(3)} … ${stats.max.toFixed(3)}`],
        ["near-zero", `${(stats.sparsity * 100).toFixed(1)}%`],
      ].map(([label, value]) => (
        <div key={label}>
          <Label>{label}</Label>
          <div className="mt-0.5 font-mono text-[13px] tabular-nums text-[var(--color-body)]">{value}</div>
        </div>
      ))}
    </div>
  );
}
