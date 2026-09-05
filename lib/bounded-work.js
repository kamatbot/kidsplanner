"use strict";
// FIFO, process-wide backpressure for external I/O. Callers choose whether to
// retry a full queue. A permit is released only when the actual operation ends.
function createWorkLimiter(concurrency, maxQueued = 256) {
  let active = 0;
  const queue = [];
  function start() {
    while (active < concurrency && queue.length) {
      const { work, resolve, reject } = queue.shift();
      active++;
      Promise.resolve().then(work).then(resolve, reject).finally(() => { active--; start(); });
    }
  }
  return (work) => new Promise((resolve, reject) => {
    if (queue.length >= maxQueued) {
      const error = new Error("Work queue is full.");
      error.code = "WORK_QUEUE_FULL";
      reject(error);
      return;
    }
    queue.push({ work, resolve, reject });
    start();
  });
}
module.exports = { createWorkLimiter };
