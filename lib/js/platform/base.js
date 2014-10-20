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

  var left = { type: 'register', id: this.args[0] };
  var right = { type: 'register', id: this.args[1] };
  var out = { type: 'register', id: this.ret };

  this.registers = null;
  this.instructions = {
    literal: { inputs: [ { type: 'js' } ], output: { type: 'register' } },
    binary: {
      inputs: [ { type: 'js' }, left, right ],
      output: out,
      call: true
    },
    ret: { inputs: [ out ], output: null }
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
  else
    throw new Error('Unknown instruction type: ' + instr.type);
};

Base.prototype.doRet = function doRet(instr) {
  // Value is already in a proper register
  this.masm().Return();
};

Base.prototype.doGap = function doGap(instr) {
};
