var js = require('../js');

var heap = require('heap.js');
var assert = require('assert');

function Runtime(options) {
  this.platform = new js.platform.x64.X64(this);
  this.heap = heap.create({
    callWrapper: this.platform.callWrapper
  });
  this.compiler = new js.Compiler(this, options);
  this.platform.heap = this.heap;
  this.platform.compiler = this.compiler;

  this.tramp = {
    map: {},
    list: [],
    stub: new this.platform.Stub('runtime', 0, ''),
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
    }, {}, this);

    this.platform.registerStub(this.tramp.stub);
  }, this);

  var self = this;
  this.registerTramp('getPropertySlot',
                     function getPropertySlot(ic, obj, prop, update) {
    return self.heap.scope(function() {
      ic = self.platform.getIC('getPropertySlot',
                               self.heap.wrapPtr(ic).cast());
      obj = self.heap.wrapPtr(obj).cast();
      prop = self.heap.wrapPtr(prop).cast();
      update = self.heap.wrapPtr(update).cast();

      var updateVal = update.value();
      var before;
      var after;

      if (updateVal)
        before = obj.map();
      var res = obj.getPropertySlot(prop, update.value());
      if (updateVal)
        after = obj.map();

      // No match, always runtime
      if (res.isHole())
        return res.ptr();

      // Cache only if the map hasn't changed
      if (!updateVal || before.isSame(after))
        ic.miss(before || obj.map(), prop, res);

      return res.ptr();
    });
  });

  this.registerTramp('loadProperty', function loadProperty(obj, prop) {
    return self.heap.scope(function() {
      obj = self.heap.wrapPtr(obj).cast();
      prop = self.heap.wrapPtr(prop).cast();

      return obj.get(prop).ptr();
    });
  });

  this.registerTramp('storeProperty', function storeProperty(obj, prop, value) {
    return self.heap.scope(function() {
      obj = self.heap.wrapPtr(obj).cast();
      prop = self.heap.wrapPtr(prop).cast();
      value = self.heap.wrapPtr(value).cast();

      obj.set(prop, value);
      return self.heap.undef.ptr();
    });
  });

  this.registerTramp('log', function log(value) {
    return self.heap.scope(function() {
      console.log(self.heap.wrapPtr(value).toJSON());
    });
  });

  var types = [ 'boolean' ];

  types.forEach(function(type) {
    var map = this.heap.maps[type];

    this.registerTramp('coerce/boolean', function coerceBoolean(val) {
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
