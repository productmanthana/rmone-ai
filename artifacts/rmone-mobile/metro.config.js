const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// pnpm constantly creates and removes transient directories like
// `.pnpm/<pkg>@<ver>/node_modules/<pkg>_tmp_<pid>` during installs.
// Metro's FallbackWatcher walks every directory under the watch roots and
// crashes with ENOENT when one of those tmp dirs vanishes mid-walk.
// Block these paths from the file map so the watcher never tries to watch them.
const tmpPnpmPattern = /(^|\/)node_modules\/\.pnpm\/.+_tmp_\d+(\/.*)?$/;
const existing = config.resolver.blockList;
config.resolver.blockList = Array.isArray(existing)
  ? [...existing, tmpPnpmPattern]
  : existing
  ? [existing, tmpPnpmPattern]
  : [tmpPnpmPattern];

module.exports = config;
