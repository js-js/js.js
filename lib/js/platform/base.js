var js = require('../../js');

var jit = require('jit.js');
var util = require('util');

function BaseState() {
  this.id = 0;
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
      shallow: true,
      call: true
    },
    ret: { inputs: [ out ], output: null },
    global: {
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
      shallow: true,
      call: true
    },
    storeProperty: {
      inputs: [ reg, reg, reg ],
      output: out,
      shallow: true,
      call: true
    },
    toBoolean: {
      inputs: [ reg ],
      output: out,
      shallow: true,
      call: true
    },
    branch: {
      inputs: [ reg ],
      output: null
    },
    nop: {
      inputs: [ { type: 'any' } ],
      output: [ { type: 'any' } ]
    },
    loadArg: {
      inputs: [ { type: 'js' } ],
      output: reg
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

Base.prototype.optimize = function optimize(ssa) {
  ssa.forEach(function(block) {
    for (var i = block.instructions.length - 1; i >= 0; i--) {
      var instr = block.instructions[i];

      // Replace loadGlobal/storeGlobal with
      // loadProperty/storeProperty + global
      var res = this.replaceGlobal(instr);

      // Object = allocHashMap + allocObject
      if (!res)
        res = this.replaceObject(instr);

      // branch = toBoolean + branch
      if (!res)
        res = this.replaceBranch(instr);

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

  var state = this._baseState;
  var id = state.getId();
  var literal = {
    id: state.getId(),
    astId: instr.astId,
    ast: instr.ast,
    type: 'literal',
    inputs: [ { type: 'js', value: instr.inputs[0].value } ]
  };

  // Replace js-value with literal
  instr.inputs[0] = {
    type: 'instruction',
    id: literal.id
  };

  return [{
    id: id,
    astId: instr.astId,
    ast: instr.ast,
    type: 'global',
    inputs: []
  }, literal, {
    id: instr.id,
    astId: instr.astId,
    ast: instr.ast,
    type: type,
    inputs: [ { type: 'instruction', id: id } ].concat(instr.inputs)
  }];
};

Base.prototype.replaceObject = function replaceObject(instr) {
  if (instr.type !== 'object')
    return;

  var state = this._baseState;
  var id = state.getId();

  return [{
    id: id,
    astId: instr.astId,
    ast: instr.ast,
    type: 'allocHashMap',
    inputs: instr.inputs
  }, {
    id: instr.id,
    astId: instr.astId,
    ast: instr.ast,
    type: 'allocObject',
    inputs: [ { type: 'instruction', id: id } ]
  }];
};

Base.prototype.replaceBranch = function replaceBranch(instr) {
  if (instr.type !== 'branch')
    return;

  var state = this._baseState;
  var id = state.getId();

  return [{
    id: id,
    astId: instr.astId,
    ast: instr.ast,
    type: 'toBoolean',
    inputs: instr.inputs
  }, {
    id: instr.id,
    astId: instr.astId,
    ast: instr.ast,
    type: 'branch',
    inputs: [ { type: 'instruction', id: id } ]
  }];
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
  else if (instr.type === 'loadArg')
    return this.doLoadArg(instr);
  else
    throw new Error('Unknown instruction type: ' + instr.type);
};