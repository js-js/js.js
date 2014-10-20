var js = require('../../js');

function Base(compiler) {
  this.compiler = compiler;
  this.heap = this.compiler.heap;

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
}
module.exports = Base;

Base.prototype.masm = function masm() {
  return this.compiler.ctx.masm;
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
