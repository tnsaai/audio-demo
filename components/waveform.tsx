"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "./ui";

/**
 * Recording UI with a live waveform.
 *
 * The waveform is not decoration — while recording you otherwise have no way to
 * tell whether the mic is actually picking anything up, and a silent take only
 * reveals itself after a round trip to the box. Level history is sampled per
 * animation frame and drawn as a scrolling bar field, so clipping and dead air
 * are both visible as they happen.
 */
export function WaveformRecorder({
  onDone,
  disabled,
}: {
  onDone: (blob: Blob, filename: string, url: string) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [peak, setPeak] = useState(0);

  const canvas = useRef<HTMLCanvasElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const levels = useRef<number[]>([]);
  const audioContext = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => cleanup, []);

  function cleanup() {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (timer.current) clearInterval(timer.current);
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
    void audioContext.current?.close().catch(() => {});
    audioContext.current = null;
  }

  const draw = (analyser: AnalyserNode) => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext("2d");
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    const width = element.clientWidth;
    const height = element.clientHeight;
    if (element.width !== width * dpr || element.height !== height * dpr) {
      element.width = width * dpr;
      element.height = height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const buffer = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buffer);

    // RMS of the frame, normalised around the 128 midpoint of the byte domain.
    let sum = 0;
    for (const value of buffer) {
      const centred = (value - 128) / 128;
      sum += centred * centred;
    }
    const rms = Math.sqrt(sum / buffer.length);

    const barWidth = 3;
    const gap = 2;
    const capacity = Math.floor(width / (barWidth + gap));
    levels.current.push(rms);
    if (levels.current.length > capacity) levels.current.shift();

    setPeak((current) => Math.max(current * 0.92, rms));

    context.clearRect(0, 0, width, height);

    // Centre line, so silence reads as a line rather than an empty box.
    context.fillStyle = "rgba(139,147,167,0.25)";
    context.fillRect(0, height / 2 - 0.5, width, 1);

    levels.current.forEach((level, index) => {
      const scaled = Math.min(1, level * 2.6);
      const barHeight = Math.max(2, scaled * (height - 8));
      const x = index * (barWidth + gap);
      const y = (height - barHeight) / 2;
      context.fillStyle = scaled > 0.85 ? "#f87171" : "#4ade80";
      context.globalAlpha = 0.55 + scaled * 0.45;
      context.beginPath();
      context.roundRect(x, y, barWidth, barHeight, 1.5);
      context.fill();
    });
    context.globalAlpha = 1;

    raf.current = requestAnimationFrame(() => draw(analyser));
  };

  const start = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false },
      });
    } catch {
      alert("Microphone permission denied.");
      return;
    }

    chunks.current = [];
    levels.current = [];

    const context = new AudioContext();
    audioContext.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);

    const media = new MediaRecorder(stream);
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.current.push(event.data);
    };
    media.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks.current, { type: media.mimeType || "audio/webm" });
      onDone(blob, `recording-${Date.now()}.webm`, URL.createObjectURL(blob));
    };
    media.start();

    recorder.current = media;
    setRecording(true);
    setSeconds(0);
    timer.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    draw(analyser);
  };

  const stop = () => {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
    setPeak(0);
    if (raf.current) cancelAnimationFrame(raf.current);
    if (timer.current) clearInterval(timer.current);
    void audioContext.current?.close().catch(() => {});
    audioContext.current = null;
  };

  return (
    <div className="flex items-center gap-3">
      <Button
        disabled={disabled}
        variant={recording ? "primary" : "default"}
        onClick={recording ? stop : start}
      >
        {recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
        {recording ? "Stop" : "Record"}
      </Button>

      {recording ? (
        <div className="flex flex-1 items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-raised)] px-3 py-1.5">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--color-bad)]" />
          <canvas ref={canvas} className="h-9 min-w-0 flex-1" />
          <span className="shrink-0 font-mono text-[12px] tabular-nums text-[var(--color-body)]">
            {String(Math.floor(seconds / 60)).padStart(2, "0")}:
            {String(seconds % 60).padStart(2, "0")}
          </span>
          {peak < 0.01 && seconds > 1 ? (
            <span className="shrink-0 text-[11px] text-[var(--color-warn)]">no signal</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Static waveform for a captured or uploaded clip, with a playhead.
 * Decoding happens once; peaks are downsampled to the bar count.
 */
export function WaveformPlayer({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    void (async () => {
      try {
        const response = await fetch(url);
        const bytes = await response.arrayBuffer();
        const context = new AudioContext();
        const buffer = await context.decodeAudioData(bytes);
        await context.close();
        if (cancelled) return;

        const channel = buffer.getChannelData(0);
        const bars = 180;
        const size = Math.floor(channel.length / bars);
        const out: number[] = [];
        for (let i = 0; i < bars; i++) {
          let max = 0;
          for (let j = 0; j < size; j++) {
            const value = Math.abs(channel[i * size + j] ?? 0);
            if (value > max) max = value;
          }
          out.push(max);
        }
        const ceiling = Math.max(...out) || 1;
        setPeaks(out.map((value) => value / ceiling));
        setDuration(buffer.duration);
      } catch {
        if (!cancelled) setPeaks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (playing) element.pause();
    else void element.play();
  };

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const element = audio.current;
    if (!element || !duration) return;
    const box = event.currentTarget.getBoundingClientRect();
    element.currentTime = ((event.clientX - box.left) / box.width) * duration;
  };

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <audio
        ref={audio}
        src={url}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(event) => {
          const element = event.currentTarget;
          if (element.duration) setProgress(element.currentTime / element.duration);
        }}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value)) setDuration(value);
        }}
        className="hidden"
      />

      <button
        type="button"
        onClick={toggle}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-raised)] text-[var(--color-body)] transition-colors hover:border-[var(--color-muted)]/60"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>

      <div onClick={seek} className="flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-px">
        {peaks === null ? (
          <div className="h-1 w-full animate-pulse rounded bg-[var(--color-raised)]" />
        ) : peaks.length === 0 ? (
          <div className="h-1 w-full rounded bg-[var(--color-line)]" />
        ) : (
          peaks.map((value, index) => {
            // (index + 1) so nothing reads as played while the head is at zero.
            const played = (index + 1) / peaks.length <= progress;
            return (
              <div
                key={index}
                className="flex-1 rounded-[1px] transition-colors"
                style={{
                  height: `${Math.max(6, value * 100)}%`,
                  background: played ? "var(--color-v2)" : "var(--color-line)",
                  opacity: played ? 0.9 : 1,
                }}
              />
            );
          })
        )}
      </div>

      {duration ? (
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--color-muted)]">
          {duration.toFixed(1)}s
        </span>
      ) : null}
    </div>
  );
}
