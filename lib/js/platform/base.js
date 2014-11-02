var js = require('../../js');

var assert = require('assert');
var jit = require('jit.js');
var cfgjs = require('cfg.js');
var heap = require('heap.js');
var ir = require('cfg-ir');
var util = require('util');

function BaseState() {
  this.id = 0;
  this.argsWaiting = 0;
  this.argsTotal = 0;
  this.pendingCall = null;
  this.pendingFn = null;

  this.block = null;
  this.instr = null;
}

BaseState.prototype.getId = function getId() {
  return 'js.js/' + this.id++;
};

BaseState.prototype.createJS = function createJS(value) {
  return this.block.createValue('js', null, value);
};

function Base(runtime) {
  this.runtime = runtime;
  this.ctx = null;

  this._baseState = new BaseState();

  // NOTE: will be set by runtime
  this.heap = null;
  this.compiler = null;

  this.helpers = util._extend({}, Base.helpers);
  this.helpers.platform = this;

  this.ptrSize = 0;

  // Get helpers, args, ret
  this.init();

  this.registers = null;
  this.instructions = Base.instructions.get.call(this);
  this.instructionMethods = null;

  var self = this;
  this.stubs = jit.stubs({
    helpers: this.helpers,
    compile: function(body, options) {
      return self.ctx.compiler.compileStubs(body, options);
    }
  });

  this.cfgStubs = {};

  this.initStubs();
}
module.exports = Base;

Base.helpers = require('./base/helpers');
Base.instructions = require('./base/instructions');

Base.prototype.masm = function masm() {
  return this.ctx.masm;
};

Base.prototype.initStubs = require('./base/stubs').init;

Base.prototype.instr = function instr(type, inputs) {
  var state = this._baseState;

  var res = state.block.createValue('instruction', type, state.getId());
  if (inputs) {
    inputs.forEach(function(input) {
      res.addInput(input);
    });
  }
  return res;
};

Base.prototype.spliceCFG = function spliceCFG(block, fn) {
  this._baseState.block = block;
  for (var i = block.instructions.length - 1; i >= 0; i--) {
    var instr = block.instructions[i];

    this._baseState.instr = instr;

    var res = fn.call(this, instr);
    this._baseState.instr = null;
    if (!res)
      continue;

    block.instructions.splice.apply(block.instructions,
                                    [ i , 1 ].concat(res.list));
    if (instr !== res.replace)
      instr.replaceWith(res.replace);
  }
  this._baseState.block = null;
}

Base.prototype.optimize = function optimize(ssa) {
  ssa.forEach(function(block) {
    // Replace loadGlobal/storeGlobal with
    // loadProperty/storeProperty + global
    this.spliceCFG(block, this.replaceGlobal);

    // fn = stub allocFn
    this.spliceCFG(block, this.replaceFn);

    // object = stub allocObject
    this.spliceCFG(block, this.replaceObject);

    // Replace store property/load property with a stub call
    this.spliceCFG(block, this.replaceProp);

    // binary = stub binary
    this.spliceCFG(block, this.replaceBinary);

    // branch = toBoolean + isTrue
    this.spliceCFG(block, this.replaceBranch);

    // first pushArg = checkMap + alignStack %num + pushArg
    this.spliceCFG(block, this.replacePushArg);
  }, this);
};

Base.prototype.replaceGlobal = function replaceGlobal(instr) {
  var type;
  if (instr.type === 'loadGlobal')
    type = 'loadProperty';
  else if (instr.type === 'storeGlobal')
    type = 'storeProperty';
  else if (instr.type === 'deleteGlobal')
    type = 'deleteProperty';
  else
    return false;

  var literal = this.instr('literal', [ instr.removeInput(0) ]);

  var global = this.instr('global');
  var op = this.instr(type, [
    global,
    literal
  ].concat(instr.removeAllInputs()));

  return {
    list: [ global, literal, op ],
    replace: op
  };
};

Base.prototype.replaceObject = function replaceObject(instr) {
  if (instr.type !== 'object')
    return;

  var state = this._baseState;
  var HashMap = heap.entities.HashMap;

  var size = this.instr('literal', instr.removeAllInputs());
  size.inputs[0].id = Math.max(size.inputs[0].id, HashMap.minSize);

  var stub = this.instr('stub', [ state.createJS('allocObject') ]);
  var arg = this.instr('pushArg', [ size ]);
  var call = this.instr('callStub', [
    stub,
    state.createJS(1)
  ]);
  return {
    list: [ size, stub, arg, call ],
    replace: call
  };
};

Base.prototype.replaceFn = function replaceFn(instr) {
  if (instr.type !== 'fn')
    return;

  var state = this._baseState;

  var code = this.instr('code', instr.removeAllInputs());
  var stub = this.instr('stub', [ state.createJS('allocFn') ]);
  var arg = this.instr('pushArg', [ code ]);
  var call = this.instr('callStub', [
    stub,
    state.createJS(1)
  ]);
  return {
    list: [ code, stub, arg, call ],
    replace: call
  };
};

Base.prototype.replaceBinary = function replaceBinary(instr) {
  if (instr.type !== 'binary')
    return;

  var state = this._baseState;
  var inputs = instr.removeAllInputs();

  var op = inputs[0].id;
  var stub = this.instr('stub', [ state.createJS('binary/' + op) ]);
  var left = this.instr('pushArg', [ inputs[2] ]);
  var right = this.instr('pushArg', [ inputs[1] ]);
  var call = this.instr('callStub', [
    stub,
    state.createJS(2)
  ]);

  return {
    list: [ stub, left, right, call ],
    replace: call
  };
};

Base.prototype.replaceBranch = function replaceBranch(instr) {
  if (instr.type !== 'branch')
    return;

  var toBoolean = this.instr('toBoolean', instr.removeAllInputs());
  var isTrue = this.instr('isTrue', [
    toBoolean
  ]);

  return {
    list: [ toBoolean, isTrue ],
    replace: isTrue
  };
};

Base.prototype.replacePushArg = function replacePushArg(instr) {
  if (instr.type !== 'pushArg' &&
      instr.type !== 'call' &&
      instr.type !== 'callStub') {
    return;
  }

  // Find number of args
  var state = this._baseState;
  if (instr.type === 'call') {
    state.argsWaiting = instr.inputs[2].id;
    state.argsTotal = instr.inputs[2];
    state.pendingFn = instr.inputs[0];
    state.pendingCall = instr;
    if (state.argsWaiting !== 0)
      return;
  } else if (instr.type === 'callStub') {
    state.argsWaiting = instr.inputs[1].id;
    state.argsTotal = instr.inputs[1];
    state.pendingFn = instr.inputs[0];
    state.pendingCall = instr;
    if (state.argsWaiting !== 0)
      return;
  }

  // Not the first push
  if (instr.type === 'pushArg' && --state.argsWaiting !== 0)
    return;

  var out = [];

  var align;
  if (state.pendingCall.type === 'call') {
    var checkMap = this.instr('checkMap', [
      state.pendingFn,
      state.createJS('function')
    ]);
    out.push(checkMap);

    align = this.instr('alignStack', [ state.argsTotal ]);
  } else {
    align = this.instr('alignStubStack', [ state.argsTotal ]);
  }
  out.push(align, instr);

  return {
    list: out,
    replace: instr
  };
};

Base.prototype.replaceProp = function replaceProp(instr) {
  if (instr.type !== 'loadProperty' &&
      instr.type !== 'storeProperty' &&
      instr.type !== 'deleteProperty') {
    return false;
  }

  var state = this._baseState;

  var args = [];
  for (var i = instr.inputs.length - 1; i >= 0; i--)
    args.push(this.instr('pushArg', [ instr.removeInput(i) ]));

  var stub = this.instr('stub', [ state.createJS(instr.type) ]);
  var call = this.instr('callStub', [ stub, state.createJS(args.length) ]);

  return {
    list: [ stub ].concat(args, call),
    replace: call
  };
};

Base.prototype.genInstruction = function genInstruction(instr) {
  if (instr.type === 'gap')
    return this.genGap(instr);

  if (this.instructionMethods === null)
    this.instructionMethods = Base.instructions.getMethods(this);

  var method = this.instructionMethods[instr.type];
  if (!method)
    throw new Error('Unknown instruction type: ' + instr.type);

  return method.call(this, instr);
};

Base.prototype.declareCFGStub = function declareCFGStub(name, body, locals) {
  this.cfgStubs[name] = {
    fn: null,
    body: body,
    locals: locals
  };
};

Base.prototype.genCFGStub = function genCFGStub(name) {
  var stub = this.cfgStubs[name];
  assert(stub, 'CFG Stub ' + name + ' not found');
  if (stub.fn)
    return stub.fn;

  var body = stub.body;
  if (typeof body === 'function')
    body = body.toString().replace(/^function[^{]*{\/\*|\*\/}$/g, '');

  var cfg = ir.parse(body, stub.locals);
  var res;
  this.runtime.persistent.wrap(function() {
    res = this.runtime.compiler.compileCFG(cfg);
  }, this);

  stub.fn = res;
  return res;
};
