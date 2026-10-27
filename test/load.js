// Loads a plugin script the way the browser does (as a plain script with a global `driftPlugin`) and returns what it
// passed to driftPlugin.__expose. No DOM: content.js sees no `document` and only defines its pure functions.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function load(file) {
  const exposed = {};
  const noop = () => {};
  const driftPlugin = {
    __expose: (o) => Object.assign(exposed, o),
    runtime: { onMessage: noop, onCommand: noop, onPageMessage: noop, sendMessage: noop },
    storage: { get: () => Promise.resolve(null), set: () => Promise.resolve() },
    ui: {},
    tabs: {},
  };
  const context = vm.createContext({ driftPlugin, console, URL, Promise });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context, { filename: file });
  return exposed;
}

// Values made inside the vm have another realm's prototypes: compare them as plain JSON.
const plain = (x) => JSON.parse(JSON.stringify(x));

module.exports = { load, plain };
