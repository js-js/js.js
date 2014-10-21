var js = require('../../js');

var jit = require('jit.js');
var util = require('util');

function Base(compiler) {
  this.compiler = compiler;
  this.ctx = null;

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
      call: true
    },
    ret: { inputs: [ out ], output: null },
    loadGlobal: {
      inputs: [ reg, reg ],
      output: out,
      call: true
    },
    storeGlobal: {
      inputs: [ reg, reg, reg ],
      output: out,
      call: true
    }
  };

  this.stubs = jit.stubs({
    helpers: this.helpers
  });

  this.initStubs();
}
module.exports = Base;

Base.helpers = require('./base/helpers');

Base.prototype.masm = function masm() {
  return this.ctx.masm;
};

Base.prototype.optimize = function optimize(ssa) {
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
  else if (instr.type === 'loadGlobal')
    return this.doLoadGlobal(instr);
  else if (instr.type === 'storeGlobal')
    return this.doStoreGlobal(instr);
  else
    throw new Error('Unknown instruction type: ' + instr.type);
};
