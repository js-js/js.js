var js = exports;

js.platform = {};
js.platform.Base = require('./js/platform/base');
js.platform.X64 = require('./js/platform/x64');

js.Compiler = require('./js/compiler');
js.Runtime = require('./js/runtime');

js.create = require('./js/runtime').create;
