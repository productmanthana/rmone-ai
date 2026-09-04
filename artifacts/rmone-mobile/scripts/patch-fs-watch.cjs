// Preloaded via NODE_OPTIONS to harden fs.watch against pnpm's transient
// `_tmp_<pid>` directories. Metro's FallbackWatcher walks the entire
// node_modules tree and synchronously calls fs.watch() on every directory.
// During a concurrent pnpm install/refresh, those tmp dirs may vanish between
// readdir() and watch(), causing an unrecoverable ENOENT crash. We catch
// ENOENT here and return a no-op watcher so the bundler can continue.
const fs = require("fs");
const { EventEmitter } = require("events");

const originalWatch = fs.watch;

function makeNoopWatcher() {
  const emitter = new EventEmitter();
  emitter.close = () => {};
  emitter.ref = () => emitter;
  emitter.unref = () => emitter;
  return emitter;
}

fs.watch = function patchedWatch(...args) {
  try {
    return originalWatch.apply(this, args);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return makeNoopWatcher();
    }
    throw err;
  }
};
