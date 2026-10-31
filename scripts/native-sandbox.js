'use strict';
var vm = require('node:vm');

// Mirror Pebble's locked-down timer globals, rather than silently supplying
// Node timers to a bundled plugin which can never use them on the phone.
module.exports = function nativeSandbox(context) {
  var sandbox = vm.createContext(context);
  // Define these in the guest realm: Node's VM can turn a throwing host getter
  // into a ReferenceError when the plugin reads an unqualified global name.
  vm.runInContext("['setTimeout','clearTimeout','setInterval','clearInterval'].forEach(function(name) {" +
    "Object.defineProperty(globalThis,name,{get:function() {throw new Error(name+' is not available to plugins');}});" +
    "});", sandbox);
  return sandbox;
};
