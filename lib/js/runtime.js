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

  this.initObject();
  this.initUtils();
  this.initType();
  this.initBinary();
};

Runtime.prototype.initObject = function initObject() {
  this.registerTramp('getPropertySlot',
                     function getPropertySlot(ic, obj, prop, update) {
    ic = this.platform.getIC('getPropertySlot', ic);

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
      return res;

    // Cache only if the map hasn't changed
    if (!updateVal || before.isSame(after))
      ic.miss(before || obj.map(), prop, res);

    return res;
  });

  this.registerTramp('loadProperty', function loadProperty(obj, prop) {
    return obj.get(prop);
  });

  this.registerTramp('storeProperty', function storeProperty(obj, prop, value) {
    obj.set(prop, value);
    return this.heap.undef;
  });
};

Runtime.prototype.initUtils = function initUtils() {
  this.registerTramp('log', function log(value) {
    console.log(value.toJSON());
  });
};

Runtime.prototype.initType = function initType() {
  var types = [ 'boolean' ];

  types.forEach(function(type) {
    var map = this.heap.maps[type];

    this.registerTramp('coerce/boolean', function coerceBoolean(val) {
      return val.coerceTo(map);
    });
  }, this);
};

Runtime.prototype.initBinary = function initBinary() {
  var ops = [ '+', '-', '*', '/', '%' ];

  ops.forEach(function(op) {
    this.registerTramp('binary/' + op, function binary(left, right) {
      if (op === '+')
        return left.add(right);
      else if (op === '-')
        return left.sub(right);
      else if (op === '*')
        return left.mul(right);
      else if (op === '/')
        return left.div(right);
      else if (op === '%')
        return left.mod(right);
      else
        throw new Error('Binary runtime tramp not implemented for: ' + op);
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
  var self = this;
  function trampWrap() {
    var args = arguments;
    return self.heap.scope(function() {
      // Wrap every argument
      args = Array.prototype.slice.call(args, 0, fn.length).map(function(arg) {
        return this.heap.wrapPtr(arg).cast();
      }, this);
      var res = fn.apply(this, args);

      // Return pointer, not a handle
      if (res)
        return res.ptr();
    }, self);
  }

  var res = this.tramp.list.push(trampWrap) - 1;
  this.tramp.map[name] = res;
  return res;
};
