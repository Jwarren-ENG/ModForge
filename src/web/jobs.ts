import crypto from "node:crypto";
import type { Response } from "express";
import type { GenerationEvent } from "../core/runGeneration.js";

export interface Job {
  id: string;
  idea: string;
  events: GenerationEvent[];
  done: boolean;
  startedAt: number;
  listeners: Set<Response>;
  /** Cumulative byte count of build:chunk content captured so far. */
  buildLogBytes: number;
  /** True once the per-job build-log byte cap has been hit. */
  buildLogTruncated: boolean;
  /** Absolute path to the project workspace, set on the `workspace` event. */
  projectPath?: string;
  /** Project-relative PNG paths written by codegen. The preview endpoint
   *  ONLY serves files whose paths appear in this list — it never accepts
   *  arbitrary client-provided paths. */
  pngFiles: string[];
  /** Absolute path to the built JAR, recorded from the `done` event's
   *  outcome.jarPath. The download/reveal endpoints use this — never a
   *  client-supplied path. */
  jarPath?: string;
}

const jobs = new Map<string, Job>();
const MAX_JOBS = 50;
const JOB_TTL_MS = 60 * 60 * 1000; // 1h
const MAX_EVENTS_PER_JOB = 5000; // keep total event count bounded
const MAX_BUILD_LOG_BYTES = 256 * 1024; // 256 KiB of gradle output per job

const TRUNCATION_NOTE = "\n[build log truncated by server]\n";

function gc(): void {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.startedAt > JOB_TTL_MS) jobs.delete(id);
  }
  if (jobs.size >= MAX_JOBS) {
    const sorted = [...jobs.values()].sort((a, b) => a.startedAt - b.startedAt);
    const drop = sorted.length - MAX_JOBS + 1;
    for (let i = 0; i < drop; i++) jobs.delete(sorted[i]!.id);
  }
}

export function createJob(idea: string): Job {
  gc();
  const job: Job = {
    id: crypto.randomUUID(),
    idea,
    events: [],
    done: false,
    startedAt: Date.now(),
    listeners: new Set(),
    buildLogBytes: 0,
    buildLogTruncated: false,
    pngFiles: [],
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function jobCount(): number {
  return jobs.size;
}

export function activeJobCount(): number {
  let n = 0;
  for (const j of jobs.values()) if (!j.done) n++;
  return n;
}

/** Test-only — clears all in-memory state. */
export function _resetJobs(): void {
  jobs.clear();
}

export function pushEvent(job: Job, event: GenerationEvent): void {
  // Side-effect tracking for the preview endpoint. We capture the project
  // workspace path and the list of PNG outputs from codegen so the preview
  // endpoint can resolve a job-id + file-index to a real PNG without ever
  // accepting a client-supplied filesystem path.
  if (event.type === "workspace") {
    job.projectPath = event.projectPath;
  } else if (event.type === "codegen:done") {
    job.pngFiles = event.written.filter((p) => p.toLowerCase().endsWith(".png"));
  } else if (event.type === "done" && event.outcome.success && event.outcome.jarPath) {
    job.jarPath = event.outcome.jarPath;
  }

  // build:chunk has its own byte budget so a runaway gradle log can't
  // pin server memory. Done/error events are never throttled.
  if (event.type === "build:chunk") {
    const room = MAX_BUILD_LOG_BYTES - job.buildLogBytes;
    if (room <= 0) {
      if (!job.buildLogTruncated) {
        job.buildLogTruncated = true;
        appendAndBroadcast(job, { type: "build:chunk", chunk: TRUNCATION_NOTE });
      }
      return; // drop further chunks silently after the marker
    }
    if (event.chunk.length > room) {
      const cropped: GenerationEvent = {
        type: "build:chunk",
        chunk: event.chunk.slice(0, room),
      };
      job.buildLogBytes = MAX_BUILD_LOG_BYTES;
      appendAndBroadcast(job, cropped);
      // Marker will be appended on the next chunk via the room <= 0 branch.
      return;
    }
    job.buildLogBytes += event.chunk.length;
  }

  appendAndBroadcast(job, event);

  if (event.type === "done" || event.type === "error") {
    job.done = true;
    for (const listener of job.listeners) {
      try { listener.end(); } catch { /* */ }
    }
    job.listeners.clear();
  }
}

function appendAndBroadcast(job: Job, event: GenerationEvent): void {
  job.events.push(event);
  if (job.events.length > MAX_EVENTS_PER_JOB) {
    // Keep the first 100 events as context; drop the middle. Never drops the
    // tail, so done/error always survive.
    job.events.splice(100, job.events.length - MAX_EVENTS_PER_JOB);
  }
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const listener of job.listeners) {
    try { listener.write(payload); } catch { /* closed */ }
  }
}
