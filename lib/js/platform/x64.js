var js = require('../../js');
var Base = js.platform.Base;

var assert = require('assert');
var jit = require('jit.js');
var util = require('util');

function X64(compiler) {
  Base.call(this, compiler);

  this.ptrSize = 8;
  this.registers = [
    'rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi',
    'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14'
  ];
  this.context = 'r15';

  this.callWrapper = jit.compile(function() {
    this.Proc(function() {
      // Callee-save
      this.spill([ 'rbx', 'r12', 'r13', 'r14', 'r15' ], function() {
        // Shift args
        this.mov('rax', 'rdi');
        this.mov('rdi', 'rsi');
        this.mov('rsi', 'rdx');
        this.mov('rdx', 'rcx');
        this.mov('rcx', 'r8');
        this.mov('r8', 'r9');

        this.call('rax');
      });
      this.Return();
    });
  })._buffer;
}
util.inherits(X64, Base);
module.exports = X64;

X64.helpers = require('./x64/helpers');

X64.prototype.init = function init() {
  // Calling convention info for Base
  this.args = [ 'rdi', 'rsi', 'rdx', 'rcx', 'r8', 'r9' ];
  this.ret = 'rax';
  this.helpers = util._extend(this.helpers, X64.helpers);
};

X64.prototype.initStubs = function initStubs() {
  this.stubs.define('binary+', function(left, right) {
    this.isSmi(left);
    this.j('nz', 'non-smi');
    this.isSmi(right);
    this.j('nz', 'non-smi');

    // Both SMIs
    this.mov('rax', left);
    this.add('rax', right);
    this.j('o', 'overflow');
    this.Return();

    // TODO(indutny): invoke runtime
    this.bind('non-smi');
    this.int3();
    this.Return();

    // TODO(indutny): convert to doubles
    this.bind('overflow');
    this.int3();
    this.Return();
  });
};

X64.prototype.genInstruction = function genInstruction(instr) {
  if (instr.type === 'literal')
    return this.doLiteral(instr);
  else if (instr.type === 'binary')
    return this.doBinary(instr);
  else
    return X64.super_.prototype.genInstruction.call(this, instr);
};

X64.prototype.doLiteral = function doLiteral(instr) {
  var masm = this.masm();

  assert.equal(instr.output.type, 'register');

  var value = instr.inputs[0].value;
  if (typeof value === 'number')
    value = this.heap.smi(value);
  else
    throw new Error('Unsupported literal type: ' + typeof value);

  masm.mov(instr.output.id, value.ptr());

  // GC reference
  if (value.type !== 'smi')
    this.ctx.addReference(masm.getOffset());
};

X64.prototype.doBinary = function doBinary(instr) {
  assert.equal(instr.output.type, 'register');
  assert.equal(instr.inputs[1].type, 'register');
  assert.equal(instr.inputs[2].type, 'register');

  this.masm().stub(instr.output.id,
                   'binary' + instr.inputs[0].value,
                   instr.inputs[1].id,
                   instr.inputs[2].id);
};
