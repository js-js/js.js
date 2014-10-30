var js = require('../../js');

var assert = require('assert');
var jit = require('jit.js');
var ir = require('cfg-ir');
var util = require('util');

function BaseState() {
  this.id = 0;
  this.argsWaiting = 0;
  this.argsTotal = 0;
  this.pendingFn = null;

  this.instr = null;
}

BaseState.prototype.getId = function getId() {
  return 'js.js/' + this.id++;
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

  var out = { type: 'register', id: this.ret };
  var reg = { type: 'register' };

  this.registers = null;
  this.instructions = {
    literal: { inputs: [ { type: 'js' } ], output: reg },
    binary: {
      inputs: [ { type: 'js' }, reg, reg ],
      output: out,
      shallow: true
    },
    ret: { inputs: [ out ], output: null },
    global: {
      inputs: [],
      output: reg
    },
    'this': {
      inputs: [],
      output: reg
    },
    self: {
      inputs: [],
      output: reg
    },
    allocHashMap: {
      inputs: [ { type: 'js' } ],
      output: out
    },
    allocObject: {
      inputs: [ reg ],
      output: out
    },
    toBoolean: {
      inputs: [ reg ],
      output: out,
      shallow: true
    },
    branch: {
      inputs: [ reg ],
      output: null
    },
    nop: {
      inputs: [ { type: 'any' } ],
      output: [ reg ]
    },
    loadArg: {
      inputs: [ { type: 'js' } ],
      output: reg
    },
    pushArg: {
      inputs: [ reg ],
      output: null
    },
    alignStack: {
      inputs: [ { type: 'js' } ],
      output: null
    },
    allocFn: {
      inputs: [ { type: 'js' }, reg ],
      output: out
    },
    checkMap: {
      inputs: [ reg, { type: 'js' } ],
      output: null,
      shallow: true
    },
    call: {
      inputs: [ reg, reg, { type: 'js' } ],
      output: out,
      call: true,
      shallow: true
    },
    stub: {
      inputs: [ { type: 'js' } ],
      output: reg,
      shallow: true
    },
    runtimeId: {
      inputs: [ { type: 'js' } ],
      output: reg,
      shallow: true
    },
    runtime: {
      inputs: [ ],
      output: reg,
      shallow: true
    },
    brk: {
      inputs: [ ],
      output: null,
      shallow: true
    }
  };

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

Base.prototype.masm = function masm() {
  return this.ctx.masm;
};

Base.prototype.initStubs = require('./base/stubs').init;

Base.prototype.instr = function instr(type, inputs, id) {
  var state = this._baseState;

  return {
    id: id || state.getId(),
    type: type,
    ast: state.instr.ast,
    astId: state.instr.astId,
    inputs: inputs
  };
};

Base.prototype.spliceCFG = function spliceCFG(block, fn) {
  for (var i = block.instructions.length - 1; i >= 0; i--) {
    var instr = block.instructions[i];

    this._baseState.instr = instr;

    var res = fn.call(this, instr);
    if (res)
      block.instructions.splice.apply(block.instructions,
                                      [ i , 1 ].concat(res));

    this._baseState.instr = null;
  }
}

Base.prototype.optimize = function optimize(ssa) {
  ssa.forEach(function(block) {
    // Replace loadGlobal/storeGlobal with
    // loadProperty/storeProperty + global
    this.spliceCFG(block, this.replaceGlobal);

    // fn =
    //   fn
    //   proto = object
    //   storeProperty fn, %prototype, proto
    this.spliceCFG(block, this.replaceFn);

    // Object = allocHashMap + allocObject
    this.spliceCFG(block, this.replaceObject);

    // Replace store property/load property with a stub call
    this.spliceCFG(block, this.replaceProp);

    // branch = toBoolean + branch
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

  var literal = this.instr('literal', [
    { type: 'js', value: instr.inputs[0].value }
  ]);

  // Replace js-value with literal
  instr.inputs[0] = {
    type: 'instruction',
    id: literal.id
  };

  var global = this.instr('global', []);
  var op = this.instr(type, [
    { type: 'instruction', id: global.id }
  ].concat(instr.inputs), instr.id);

  return [ global, literal, op ];
};

Base.prototype.replaceObject = function replaceObject(instr) {
  if (instr.type !== 'object' && instr.type !== 'fn')
    return;

  var type;
  var hm;
  var rest;
  if (instr.type === 'object') {
    type = 'allocObject';
    hm = this.instr('allocHashMap', instr.inputs);
    rest = [];
  } else {
    type = 'allocFn';
    hm = this.instr('allocHashMap', [ { type: 'js', value: 0 } ]);
    rest = instr.inputs;
  }

  var obj = this.instr(type, rest.concat([
    { type: 'instruction', id: hm.id }
  ]), instr.id);

  return [ hm, obj ];
};

Base.prototype.replaceFn = function replaceFn(instr) {
  if (instr.type !== 'fn')
    return;

  var fn = instr;
  var proto = this.instr('object', [ { type: 'js', value: 0 } ]);
  var literal = this.instr('literal', [ { type: 'js', value: 'prototype' } ]);
  var store = this.instr('storeProperty', [
    { type: 'instruction', id: fn.id },
    { type: 'instruction', id: literal.id },
    { type: 'instruction', id: proto.id }
  ]);

  return [ fn, proto, literal, store ];
};

Base.prototype.replaceBranch = function replaceBranch(instr) {
  if (instr.type !== 'branch')
    return;

  var toBoolean = this.instr('toBoolean', instr.inputs);
  var branch = this.instr('branch', [
    { type: 'instruction', id: toBoolean.id }
  ], instr.id);

  return [toBoolean, branch];
};

Base.prototype.replacePushArg = function replacePushArg(instr) {
  if (instr.type !== 'pushArg' && instr.type !== 'call')
    return;

  // Find number of args
  var state = this._baseState;
  if (instr.type === 'call') {
    state.argsWaiting = instr.inputs[2].value;
    state.argsTotal = state.argsWaiting;
    state.pendingFn = instr.inputs[0];
    if (state.argsWaiting !== 0)
      return;
  }

  // Not the first push
  if (instr.type === 'pushArg' && --state.argsWaiting !== 0)
    return;

  var checkMap = this.instr('checkMap', [
    state.pendingFn,
    { type: 'js', value: 'function' }
  ]);
  var align = this.instr('alignStack', [
    { type: 'js', value: state.argsTotal }
  ]);

  return [ checkMap, align, instr ];
};

Base.prototype.replaceProp = function replaceProp(instr) {
  if (instr.type !== 'loadProperty' &&
      instr.type !== 'storeProperty' &&
      instr.type !== 'deleteProperty') {
    return false;
  }

  var args = [];
  for (var i = instr.inputs.length - 1; i >= 0; i--)
    args.push(this.instr('pushArg', [ instr.inputs[i] ]));

  var stub = this.instr('stub', [
    { type: 'js', value: instr.type }
  ]);
  var global = this.instr('global', []);
  var call = this.instr('call', [
    { type: 'instruction', id: stub.id },
    { type: 'instruction', id: global.id },
    { type: 'js', value: instr.inputs.length }
  ], instr.id);

  return [ global, stub ].concat(args, call);
};

Base.prototype.genInstruction = function genInstruction(instr) {
  if (instr.type === 'ret')
    return this.genRet(instr);
  else if (instr.type === 'gap')
    return this.genGap(instr);
  else if (instr.type === 'literal')
    return this.genLiteral(instr);
  else if (instr.type === 'binary')
    return this.genBinary(instr);
  else if (instr.type === 'global')
    return this.genGlobal(instr);
  else if (instr.type === 'this')
    return this.genThis(instr);
  else if (instr.type === 'self')
    return this.genSelf(instr);
  else if (instr.type === 'allocHashMap')
    return this.genAllocHashMap(instr);
  else if (instr.type === 'allocObject')
    return this.genAllocObject(instr);
  else if (instr.type === 'toBoolean')
    return this.genToBoolean(instr);
  else if (instr.type === 'branch')
    return this.genBranch(instr);
  else if (instr.type === 'nop')
    return this.genNop(instr);
  else if (instr.type === 'to_phi')
    return this.genNop(instr);
  else if (instr.type === 'loadArg')
    return this.genLoadArg(instr);
  else if (instr.type === 'pushArg')
    return this.genPushArg(instr);
  else if (instr.type === 'alignStack')
    return this.genAlignStack(instr);
  else if (instr.type === 'allocFn')
    return this.genAllocFn(instr);
  else if (instr.type === 'checkMap')
    return this.genCheckMap(instr);
  else if (instr.type === 'call')
    return this.genCall(instr);
  else if (instr.type === 'stub')
    return this.genStub(instr);
  else if (instr.type === 'runtimeId')
    return this.genRuntimeId(instr);
  else if (instr.type === 'runtime')
    return this.genRuntime(instr);
  else if (instr.type === 'brk')
    return this.genBrk(instr);
  else
    throw new Error('Unknown instruction type: ' + instr.type);
};

Base.prototype.declareCFGStub = function declareCFGStub(name, body) {
  this.cfgStubs[name] = {
    fn: null,
    body: body
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

  var cfg = ir.parse(body);
  var res;
  this.runtime.persistent.wrap(function() {
    res = this.runtime.compiler.compileCFG(cfg);
  }, this);

  stub.fn = res;
  return res;
};
