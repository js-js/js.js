var js = require('../../js');
var Base = js.platform.Base;

var assert = require('assert');
var heap = require('heap.js');
var jit = require('jit.js');
var util = require('util');

function X64(compiler) {
  Base.call(this, compiler);

  this.ptrSize = 8;
  this.registers = [
    'rax', 'rbx', 'rcx', 'rdx', 'rsi',
    'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14'
  ];
  this.context = 'rdi';
  this.scratch = 'r15';

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

X64.prototype.initStubs = require('./x64/stubs').init;

X64.prototype.genInstruction = function genInstruction(instr) {
  return X64.super_.prototype.genInstruction.call(this, instr);
};

X64.prototype._moveToSlot = function _moveToSlot(move) {
  if (move.type === 'register')
    return move.id;
  else if (move.type === 'stack')
    return [ 'rbp', -(move.id + 1) * this.ptrSize ];
  else
    throw new Error('Unknown move slot type: ' + move.type);
};

X64.prototype.doProc = function doProc(spills, body) {
  var masm = this.masm();

  // Align stack on 16-byte boundary
  if ((spills % 2) !== 0)
    spills++;

  masm.push('rbp');
  masm.mov('rbp', 'rsp');
  masm.sub('rsp', spills * this.ptrSize);

  body();
};

Base.prototype.doRet = function doRet() {
  var masm = this.masm();

  masm.mov('rsp', 'rbp');
  masm.pop('rbp');
  masm.ret();
};

X64.prototype.doGap = function doGap(instr) {
  var masm = this.masm();

  for (var i = 0; i < instr.moves.length; i++) {
    var move = instr.moves[i];

    var from = this._moveToSlot(move.from);
    var to = this._moveToSlot(move.to);

    if (move.type === 'move') {
      masm.mov(to, from);
    } else if (move.type === 'swap') {
      if (typeof to === 'string' && typeof from === 'string') {
        masm.xchg(to, from);
      } else {
        masm.mov(this.scratch, to);
        masm.mov(to, from);
        masm.mov(from, this.scratch);
      }
    } else {
      throw new Error('Unknown move type: ' + move.type);
    }
  }
};

X64.prototype.doLiteral = function doLiteral(instr) {
  var masm = this.masm();

  assert.equal(instr.output.type, 'register');

  var value = instr.inputs[0].value;
  if (typeof value === 'number')
    value = this.heap.smi(value);
  else if (typeof value === 'string')
    value = this.heap.allocString(value);
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

X64.prototype.global = function global(reg) {
  var masm = this.masm();

  masm.mov(reg, this.context);
  masm.mov(reg, masm.heapPtr(reg, heap.entities.Context.offsets.global));
};

X64.prototype.doLoadGlobal = function doLoadGlobal(instr) {
  // Load global object
  this.global(this.scratch);

  // Perform lookup
  this.masm().stub(instr.output.id,
                   'loadProperty',
                   this.scratch,
                   instr.inputs[0].id);
};

X64.prototype.doStoreGlobal = function doLoadGlobal(instr) {
  // Load global object
  this.global(this.scratch);

  // Perform lookup
  this.masm().stub(instr.output.id,
                   'storeProperty',
                   this.scratch,
                   instr.inputs[0].id,
                   instr.inputs[1].id);
};
