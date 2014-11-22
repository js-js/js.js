var js = exports;

js.platform = {};

js.platform.base = {};
js.platform.base.helpers = require('./js/platform/base/helpers');
js.platform.base.instructions = require('./js/platform/base/instructions');
js.platform.base.stub = require('./js/platform/base/stub');

js.platform.base.ic = {};
js.platform.base.ic.Base = require('./js/platform/base/ic/base');
js.platform.base.ic.extend = js.platform.base.ic.Base.extend;
js.platform.base.ic.GetPropertySlot =
    require('./js/platform/base/ic/get-property');

js.platform.base.Base = require('./js/platform/base');

js.platform.x64 = {};
js.platform.x64.helpers = require('./js/platform/x64/helpers');
js.platform.x64.X64 = require('./js/platform/x64');

js.Compiler = require('./js/compiler');
js.Runtime = require('./js/runtime');

js.create = require('./js/runtime').create;
