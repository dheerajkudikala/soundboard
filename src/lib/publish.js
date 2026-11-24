import { db } from "./db";
import { getDbUrl, pushBoard } from "./cloudDb";

const listeners = new Set();
let timer = 0;
let running = false;
let queued = false;

function emit(status) {
  listeners.forEach((fn) => fn(status));
}

async function setStatus(value) {
  await db.meta.put({ key: "publishStatus", value });
  emit(value);
  return value;
}

export async function getPublishStatus() {
  const row = await db.meta.get("publishStatus");
  return row?.value || { state: "idle" };
}

export function onPublishStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function publishNow() {
  const url = await getDbUrl();
  if (!url) {
    await setStatus({ state: "need-db", at: Date.now() });
    return;
  }
  await setStatus({ state: "saving", at: Date.now() });
  const result = await pushBoard();
  if (result?.skipped === "need-db") {
    await setStatus({ state: "need-db", at: Date.now() });
    return;
  }
  await setStatus({ state: "ok", at: Date.now(), clips: result.clips });
}

export function queuePublish() {
  queued = true;
  window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    if (running) return;
    running = true;
    try {
      while (queued) {
        queued = false;
        try {
          await publishNow();
        } catch (error) {
          await setStatus({
            state: "error",
            at: Date.now(),
            message: error.message || "Could not update the database",
          });
        }
      }
    } finally {
      running = false;
    }
  }, 700);
}
