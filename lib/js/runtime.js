var js = require('../js');

var heap = require('heap.js');
var assert = require('assert');

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
    stub: new this.platform.Stub('runtime', ''),
    refs: null
  };
  this.persistent = this.heap.createScope();
  this.persistent.type = 'persistent';
  this.heap.globals.leave();
  this.persistent.enter();
  this.heap.globals.enter();

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
    this.tramp.stub.fn = this.compiler.masmCtx(function(ctx) {
      this.platform.genRuntimeTramp(ctx.masm);

      var res = ctx.getFunction();
      this.tramp.refs = ctx.references;
      return res;
    }, this);

    this.platform.registerStub(this.tramp.stub);
  }, this);

  var self = this;
  this.registerTramp('storeProperty', function(obj, prop, value) {
    self.heap.scope(function() {
      obj = self.heap.wrapPtr(obj).cast();
      prop = self.heap.wrapPtr(prop).cast();
      value = self.heap.wrapPtr(value);

      obj.set(prop, value);
    });
    return 0;
  });

  this.registerTramp('loadProperty', function(obj, prop) {
    return self.heap.scope(function() {
      obj = self.heap.wrapPtr(obj).cast();
      prop = self.heap.wrapPtr(prop).cast();

      return obj.get(prop).ptr();
    });
  });

  this.registerTramp('log', function(value) {
    return self.heap.scope(function() {
      console.log(self.heap.wrapPtr(value).toJSON());
    });
  });

  var types = [ 'boolean' ];

  types.forEach(function(type) {
    var map = this.heap.maps[type];

    this.registerTramp('coerce/boolean', function(val) {
      return self.heap.scope(function() {
        val = self.heap.wrapPtr(val).cast();
        return val.coerceTo(map).ptr();
      });
    });
  }, this);
};

Runtime.prototype.runTramp = function runTramp(id) {
  var args = Array.prototype.slice.call(arguments, 1);
  var index = heap.binding.readTagged(id, 0);
  return this.tramp.list[index].apply(this, args);
};

Runtime.prototype.getTramp = function getTramp(name) {
  assert(this.tramp.map[name] !== undefined,
         'Trampoline ' + name + ' not found');
  return this.tramp.map[name];
};

Runtime.prototype.registerTramp = function registerTramp(name, fn) {
  var res = this.tramp.list.push(fn) - 1;
  this.tramp.map[name] = res;
  return res;
};
