var js = require('../js');
var heap = require('heap.js');

function Runtime(options) {
  this.platform = new js.platform.X64(this);
  this.heap = heap.create({
    callWrapper: this.platform.callWrapper
  });
  this.compiler = new js.Compiler(this, options);
  this.platform.heap = this.heap;

  this.tramp = {
    map: {},
    list: [],
    fn: null
  };
  this.persistent = this.heap.createScope();

  this.initTramp();
}
module.exports = Runtime;

Runtime.create = function create(options) {
  return new Runtime(options);
};

Runtime.prototype.compile = function compile(code) {
  return this.compiler.compile(code);
};

Runtime.prototype.initTramp = function initTramp() {
  this.persistent.wrap(function() {
    this.tramp.fn = this.compiler.masmCtx(function(ctx) {
      this.platform.genRuntimeTramp(ctx.masm);

      return ctx.getCode();
    }, this);
  }, this);
};

Runtime.prototype.runTramp = function runTramp(id) {
  var args = Array.prototype.slice.call(arguments, 1);
  return this.tramp.list[id].apply(this, args);
};

Runtime.prototype.registerTramp = function registerTramp(name, fn) {
  if (this.tramp.map[name])
    return this.tramp.map[name];

  var res = this.tramp.list.push(fn) - 1;
  this.tramp.map[name] = res;
  return res;
};
