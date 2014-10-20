var js = require('../../js');
var Base = js.platform.Base;

var util = require('util');

function X64(compiler) {
  // Calling convetion info for Base
  this.args = [ 'rdi', 'rsi', 'rdx', 'rcx', 'r8', 'r9' ];
  this.ret = 'rax';

  Base.call(this, compiler);

  this.registers = [
    'rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi',
    'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14'
  ];
  this.context = 'r15';
}
util.inherits(X64, Base);
module.exports = X64;

X64.prototype.genInstruction = function genInstruction(instr) {
  if (instr.type === 'literal')
    return this.doLiteral(instr);
  else if (instr.type === 'binary')
    return this.doBinary(instr);
  else
    return X64.super_.prototype.genInstruction.call(this, instr);
};

X64.prototype.doLiteral = function doLiteral(instr) {
  console.log(instr);
  this.masm().int3();
};

X64.prototype.doBinary = function doBinary(instr) {
};
