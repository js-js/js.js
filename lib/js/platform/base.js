var js = require('../../js');

var jit = require('jit.js');
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
    loadProperty: {
      inputs: [ reg, reg ],
      output: out,
      shallow: true
    },
    storeProperty: {
      inputs: [ reg, reg, reg ],
      output: out,
      shallow: true
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
    }
  };

  var self = this;
  this.stubs = jit.stubs({
    helpers: this.helpers,
    compile: function(body, options) {
      return self.ctx.compiler.compileStubs(body, options);
    }
  });

  this.initStubs();
}
module.exports = Base;

Base.helpers = require('./base/helpers');

Base.prototype.masm = function masm() {
  return this.ctx.masm;
};

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

Base.prototype.optimize = function optimize(ssa) {
  ssa.forEach(function(block) {
    for (var i = block.instructions.length - 1; i >= 0; i--) {
      var instr = block.instructions[i];

      this._baseState.instr = instr;

      // Replace loadGlobal/storeGlobal with
      // loadProperty/storeProperty + global
      var res = this.replaceGlobal(instr);

      // Object = allocHashMap + allocObject
      if (!res)
        res = this.replaceObject(instr);

      // fn =
      //   map = allocHashMap
      //   fn = allocFn(map)
      //   protoMap = allocHashMap
      //   proto = allocObject(protoMap)
      //   storeProperty fn, %prototype, proto
      //   fn
      if (!res)
        res = this.replaceFn(instr);

      // branch = toBoolean + branch
      if (!res)
        res = this.replaceBranch(instr);

      // first pushArg = checkMap + alignStack %num + pushArg
      if (!res)
        res = this.replacePushArg(instr);

      if (!res)
        continue;

      block.instructions.splice.apply(block.instructions,
                                      [ i , 1 ].concat(res));
    }
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
  if (instr.type !== 'object')
    return;

  var hm = this.instr('allocHashMap', instr.inputs);
  var obj = this.instr('allocObject', [
    { type: 'instruction', id: hm.id }
  ], instr.id);

  return [ hm, obj ];
};

Base.prototype.replaceFn = function replaceFn(instr) {
  if (instr.type !== 'fn')
    return;

  var hashmap = this.instr('allocHashMap', [ { type: 'js', value: 0 } ]);
  var fn = this.instr(
      'allocFn',
      instr.inputs.concat({ type: 'instruction', id: hashmap.id }),
      instr.id);
  var protoMap = this.instr('allocHashMap', [ { type: 'js', value: 0 } ]);
  var proto = this.instr('allocObject', [
    { type: 'instruction', id: protoMap.id }
  ]);
  var literal = this.instr('literal', [ { type: 'js', value: 'prototype' } ]);
  var store = this.instr('storeProperty', [
    { type: 'instruction', id: fn.id },
    { type: 'instruction', id: literal.id },
    { type: 'instruction', id: proto.id }
  ]);

  return [hashmap, fn, protoMap, proto, literal, store ];
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

Base.prototype.genInstruction = function genInstruction(instr) {
  if (instr.type === 'ret')
    return this.doRet(instr);
  else if (instr.type === 'gap')
    return this.doGap(instr);
  else if (instr.type === 'literal')
    return this.doLiteral(instr);
  else if (instr.type === 'binary')
    return this.doBinary(instr);
  else if (instr.type === 'global')
    return this.doGlobal(instr);
  else if (instr.type === 'this')
    return this.doThis(instr);
  else if (instr.type === 'self')
    return this.doSelf(instr);
  else if (instr.type === 'loadProperty')
    return this.doLoadProperty(instr);
  else if (instr.type === 'storeProperty')
    return this.doStoreProperty(instr);
  else if (instr.type === 'allocHashMap')
    return this.doAllocHashMap(instr);
  else if (instr.type === 'allocObject')
    return this.doAllocObject(instr);
  else if (instr.type === 'toBoolean')
    return this.doToBoolean(instr);
  else if (instr.type === 'branch')
    return this.doBranch(instr);
  else if (instr.type === 'nop')
    return this.doNop(instr);
  else if (instr.type === 'to_phi')
    return this.doNop(instr);
  else if (instr.type === 'loadArg')
    return this.doLoadArg(instr);
  else if (instr.type === 'pushArg')
    return this.doPushArg(instr);
  else if (instr.type === 'alignStack')
    return this.doAlignStack(instr);
  else if (instr.type === 'allocFn')
    return this.doAllocFn(instr);
  else if (instr.type === 'checkMap')
    return this.doCheckMap(instr);
  else if (instr.type === 'call')
    return this.doCall(instr);
  else
    throw new Error('Unknown instruction type: ' + instr.type);
};
