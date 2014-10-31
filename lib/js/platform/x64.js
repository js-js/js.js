var js = require('../../js');
var Base = js.platform.Base;

var assert = require('assert');
var heap = require('heap.js');
var jit = require('jit.js');
var util = require('util');

function X64(compiler) {
  Base.call(this, compiler);

  var self = this;
  this.ptrSize = 8;
  this.registers = [
    'rax', 'rbx', 'rcx', 'rdx',
    'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15'
  ];
  this.context = 'rdi';
  this.scratch = 'rsi';

  this.frame = {
    'this': ['rbp', 2 * this.ptrSize],
    self: ['rbp', 3 * this.ptrSize],
    argc: ['rbp', 4 * this.ptrSize],
    argvOff: 5 * this.ptrSize,
    stubArgvOff: 2 * this.ptrSize
  };

  this.callWrapper = jit.compile(function() {
    this.Proc(function() {
      // Callee-save
      this.spill([ 'rbx', 'r12', 'r13', 'r14', 'r15' ], function() {
        // fn
        this.mov('rax', 'rdi');
        this.push('rax');

        // this
        this.push('rsi');

        // Shift args
        this.mov('rdi', 'rdx');
        this.mov('rsi', 'rcx');
        this.mov('rdx', 'r8');
        this.mov('rcx', 'r9');
        this.mov('r8', ['rbp', 2 * self.ptrSize]);
        this.mov('r9', ['rbp', 3 * self.ptrSize]);

        this.call('rax');
        this.add('rsp', 2 * self.ptrSize);
      });
      this.Return();
    });
  })._buffer;

  // Platform-specific instructions

  this.instructions.allocHashMap.scratch = [
    { type: 'register' }
  ];
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

X64.prototype.initStubs = function() {
  X64.super_.prototype.initStubs.call(this);
  require('./x64/stubs').init.call(this);
}

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

X64.prototype.genRuntimeTramp = function genRuntimeTramp(masm) {
  var self = this;

  var off = self.frame.stubArgvOff;
  var s0 = [ 'rbp', 0 * self.ptrSize + off ];
  var s1 = [ 'rbp', 1 * self.ptrSize + off ];
  var s2 = [ 'rbp', 2 * self.ptrSize + off ];
  var s3 = [ 'rbp', 3 * self.ptrSize + off ];

  masm.Proc(function() {
    this.runtime(function(a0, a1, a2, a3) {
      return self.runtime.runTramp(a0, a1, a2, a3);
    }, s0, s1, s2, s3);
    this.Return();
  });
};

X64.prototype.genProc = function genProc(spills, body) {
  var masm = this.masm();

  // Align stack on 16-byte boundary
  if (spills % 2 !== 0)
    spills++;

  masm.push('rbp');
  masm.mov('rbp', 'rsp');
  masm.sub('rsp', spills * this.ptrSize);

  body();
};

Base.prototype.genRet = function genRet() {
  var masm = this.masm();

  masm.mov('rsp', 'rbp');
  masm.pop('rbp');
  masm.ret();
};

X64.prototype.genGap = function genGap(instr) {
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

X64.prototype.genLiteral = function genLiteral(instr) {
  var masm = this.masm();

  assert.equal(instr.output.type, 'register');

  var value = instr.inputs[0].value;
  if (typeof value === 'number')
    value = this.heap.smi(value);
  else if (typeof value === 'string')
    value = this.heap.allocString(value);
  else if (typeof value === 'boolean')
    value = value ? this.heap.true_ : this.heap.false_;
  else if (typeof value === 'undefined')
    value = this.heap.undef;
  else
    throw new Error('Unsupported literal type: ' + typeof value);

  masm.mov(instr.output.id, value.ptr());

  // GC reference
  if (value.type !== 'smi')
    this.ctx.addReference(masm.getOffset());
};

X64.prototype.genBinary = function genBinary(instr) {
  assert.equal(instr.output.type, 'register');
  assert.equal(instr.inputs[1].type, 'register');
  assert.equal(instr.inputs[2].type, 'register');

  this.masm().stub(instr.output.id,
                   'binary/' + instr.inputs[0].value,
                   instr.inputs[1].id,
                   instr.inputs[2].id);
};

X64.prototype.genGlobal = function genGlobal(instr) {
  var masm = this.masm();

  var reg = instr.output.id;
  masm.mov(reg, this.context);
  masm.mov(reg, masm.heapPtr(reg, heap.entities.Context.offsets.global));
};

X64.prototype.genThis = function genThis(instr) {
  var masm = this.masm();

  var reg = instr.output.id;
  masm.mov(reg, this.frame['this']);
};

X64.prototype.genSelf = function genSelf(instr) {
  var masm = this.masm();

  var reg = instr.output.id;
  masm.mov(reg, this.frame.self);
};

X64.prototype._allocTagged = function _allocTagged(type, size) {
  var masm = this.masm();

  // Load size
  masm.stub('rax',
            'allocTagged/' + type,
            this.context,
            typeof size === 'number' ? (size << heap.tagShift) : size);
};

X64.prototype.genAllocHashMap = function genAllocHashMap(instr) {
  var HashMap = heap.entities.HashMap;
  var masm = this.masm();

  var size = instr.inputs[0].id;
  masm.lea(this.scratch, [ size, HashMap.size(0) ]);
  masm.shl(this.scratch, HashMap.shifts.fieldSize);
  this._allocTagged('hashmap', this.scratch);

  // Put the size
  masm.mov(masm.heapPtr('rax', HashMap.offsets.size), size);

  // Put the holes
  var start = instr.scratch[0].id;
  masm.lea(start, masm.heapPtr('rax', HashMap.offsets.field));

  masm.mov(this.scratch, size);
  masm.shl(this.scratch, HashMap.shifts.fieldSize);
  masm.stub(this.scratch,
            'holeFill',
            start,
            this.scratch);
};

X64.prototype.genAllocObject = function genAllocObject(instr) {
  var Object = heap.entities.Object;
  var masm = this.masm();

  this._allocTagged('object', Object.size());
  masm.mov(masm.heapPtr('rax', Object.offsets.hashmap), instr.inputs[0].id);
};

X64.prototype.genToBoolean = function genToBoolean(instr) {
  var Boolean = heap.entities.Boolean;
  var masm = this.masm();

  masm.stub('rax', 'coerce/boolean', instr.inputs[0].id);
};

X64.prototype.genBranch = function genBranch(instr) {
  var masm = this.masm();

  masm.mov(this.scratch, this.heap.true_.ptr());
  this.ctx.addReference(masm.getOffset());
  masm.cmp(this.scratch, instr.inputs[0].id);
};

X64.prototype.genNop = function genNop(instr) {
  if (instr.output.id !== instr.inputs[0].id)
    this.masm().mov(instr.output.id, instr.inputs[0].id);
};

X64.prototype.genLoadArg = function genLoadArg(instr) {
  var masm = this.masm();

  var self = this;
  var out = instr.output.id;
  var index = instr.inputs[0].value;

  // Check if we are off the argc
  masm.labelScope(function() {
    this.cmp(self.frame.argc, index << heap.tagShift);

    this.j('le', 'undef');

    this.mov(out, [ 'rbp', self.ptrSize * index + self.frame.argvOff ]);
    this.j('join');

    this.bind('undef');
    this.mov(out, self.heap.undef.ptr());
    self.ctx.addReference(this.getOffset());
    this.bind('join');
  });
};

X64.prototype.genAllocCode = function genAllocCode(instr) {
  var masm = this.masm();

  var fn = this.ctx.compiler.blocks[instr.inputs[0].value];
  masm.mov(instr.output.id, fn.code().ptr());
  this.ctx.addReference(masm.getOffset());
};

X64.prototype.genAllocFn = function genAllocFn(instr) {
  var Function = heap.entities.Function;
  var Object = heap.entities.Object;

  var masm = this.masm();

  this._allocTagged('function', Function.size());
  masm.mov(masm.heapPtr('rax', Function.offsets.code), instr.inputs[0].id);
  masm.mov(masm.heapPtr('rax', Object.offsets.hashmap), instr.inputs[1].id);
};

X64.prototype.genCheckMap = function genCheckMap(instr) {
  var masm = this.masm();

  var map = instr.inputs[1].value;
  masm.stub(this.scratch, 'checkMap/' + map, instr.inputs[0].id);
};

X64.prototype.genPushArg = function genPushArg(instr) {
  var masm = this.masm();
  masm.push(instr.inputs[0].id);
};

X64.prototype.genAlignStack = function genAlignStack(instr) {
  var masm = this.masm();

  var argc = instr.inputs[0].value;

  // Argv + argc + fn + self
  if ((argc + 3) % 2 !== 0)
    masm.push(0 << heap.tagShift);
};

X64.prototype.genCall = function genCall(instr) {
  var Function = heap.entities.Function;
  var Code = heap.entities.Code;
  var masm = this.masm();

  var argc = instr.inputs[2].value;

  masm.push(argc << heap.tagShift);

  // Set new `this` and `self`
  masm.push(instr.inputs[0].id);
  masm.push(instr.inputs[1].id);

  masm.mov(this.scratch,
           masm.heapPtr(instr.inputs[0].id, Function.offsets.code));
  masm.lea(this.scratch, masm.heapPtr(this.scratch, Code.offsets.code));
  masm.call(this.scratch);

  // Roll-out the stack
  var size = argc + 3;
  if (size % 2 !== 0)
    size++;

  masm.add('rsp', this.ptrSize * size);
};

X64.prototype.genStub = function genStub(instr) {
  var masm = this.masm();

  var stub =  this.genCFGStub(instr.inputs[0].value);
  masm.mov(instr.output.id, stub.ptr());
  this.ctx.addReference(masm.getOffset());
};

X64.prototype.genAlignStubStack = function genAlignStubStack(instr) {
  var masm = this.masm();

  var argc = instr.inputs[0].value;

  if (argc % 2 !== 0)
    masm.push(0 << heap.tagShift);
};

X64.prototype.genCallStub = function genCallStub(instr) {
  var Function = heap.entities.Function;
  var Code = heap.entities.Code;
  var masm = this.masm();

  var argc = instr.inputs[1].value;

  masm.mov(this.scratch,
           masm.heapPtr(instr.inputs[0].id, Function.offsets.code));
  masm.lea(this.scratch, masm.heapPtr(this.scratch, Code.offsets.code));
  masm.call(this.scratch);

  // Roll-out the stack
  var size = argc;
  if (size % 2 !== 0)
    size++;

  masm.add('rsp', this.ptrSize * size);
};

X64.prototype.genLoadStubArg = function genLoadStubArg(instr) {
  var masm = this.masm();

  var out = instr.output.id;
  var index = instr.inputs[0].value;

  masm.mov(out, [ 'rbp', this.ptrSize * index + this.frame.stubArgvOff ]);
};

X64.prototype.genRuntimeId = function genRuntimeId(instr) {
  var masm = this.masm();
  var value = this.heap.smi(this.runtime.getTramp(instr.inputs[0].value));

  masm.mov(instr.output.id, value.ptr());
};

X64.prototype.genRuntime = function genRuntime(instr) {
  var masm = this.masm();

  masm.mov(instr.output.id, this.runtime.tramp.fn.ptr());
  this.ctx.addReference(masm.getOffset());
};

X64.prototype.genBrk = function genBrk() {
  this.masm().int3();
};

X64.prototype.genGoto = function genGoto(succ, next) {
  if (succ.length === 0)
    return;

  var masm = this.masm();
  if (succ.length === 1) {
    if (succ[0] !== next)
      masm.jl(succ[0]);
    return;
  }

  assert.equal(succ.length, 2);
  if (succ[0] !== next)
    masm.jl('e', succ[0]);
  if (succ[1] !== next)
    masm.jl('ne', succ[1]);
};
