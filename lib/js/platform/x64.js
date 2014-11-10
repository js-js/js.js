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
    'r8', 'r9', 'r10', 'r11',
    'r12', 'r13', 'r14'
  ];
  this.context = 'rdi';
  this.scratch = 'r15';

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

  this.instructions['heap.setCurrent'].scratch = [ { type: 'register' } ];
  this.instructions['heap.setCurrent'].shallow = false;

  this.instructions.pointerFill.scratch = [ { type: 'register' } ];
  this.instructions.pointerFill.shallow = false;

  this.instructions.smiShl.inputs[1] = { type: 'register', id: 'rcx' };

  // SmiMul overwrites rdx
  this.instructions.smiMul.scratch = [
    { type: 'register', id: 'rdx' }
  ];

  this.branch = [];
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

X64.prototype.genInstruction = function genInstruction(instr) {
  return X64.super_.prototype.genInstruction.call(this, instr);
};

X64.prototype._getSlot = function _getSlot(move) {
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

    var from = this._getSlot(move.from);
    var to = this._getSlot(move.to);

    if (move.type === 'move') {
      if (Array.isArray(from) && Array.isArray(to)) {
        masm.mov(this.scratch, from);
        masm.mov(to, this.scratch);
      } else {
        masm.mov(to, from);
      }
    } else if (move.type === 'swap') {
      if (Array.isArray(from) && Array.isArray(to)) {
        masm.mov(this.scratch, to);
        masm.mov(to, from);
        masm.mov(from, this.scratch);
      } else {
        masm.xchg(to, from);
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

X64.prototype.genIsTrue = function genIsTrue(instr) {
  var masm = this.masm();

  masm.mov(this.scratch, this.heap.true_.ptr());
  this.ctx.addReference(masm.getOffset());
  masm.cmp(this.scratch, instr.inputs[0].id);
};

X64.prototype.genIsSmi = function genIsSmi(instr) {
  var masm = this.masm();

  masm.isSmi(instr.inputs[0].id);
};

X64.prototype.genSmiAdd = function genSmiAdd(instr) {
  var masm = this.masm();
  var left = instr.inputs[0].id;
  var right = instr.inputs[1].id;
  var out = instr.output.id;

  if (left === out) {
    masm.add(left, right);
  } else if (right === out) {
    masm.add(right, left);
  } else {
    masm.mov(out, left);
    masm.add(out, right);
  }
};

X64.prototype.genSmiSub = function genSmiSub(instr) {
  var masm = this.masm();
  var left = instr.inputs[0].id;
  var right = instr.inputs[1].id;
  var out = instr.output.id;

  if (left === out) {
    masm.sub(left, right);
  } else if (right === out) {
    masm.xchg(left, right);
    masm.sub(left, right);
  } else {
    masm.mov(out, left);
    masm.sub(out, right);
  }
};

X64.prototype.genSmiMul = function genSmiMul(instr) {
  var masm = this.masm();
  var left = instr.inputs[0].id;
  var right = instr.inputs[1].id;
  var out = instr.output.id;

  if (left === out) {
    masm.mul(right);
  } else if (right === out) {
    masm.mul(left);
  } else {
    masm.mov(out, left);
    masm.mul(right);
  }

  // NOTE: Does not affect OF flag
  masm.shr(out, heap.tagShift);
};

X64.prototype._branchOp = function _branchOp(op) {
  if (op === '<')
    this.branch.push({ t: 'l', f: 'ge' });
  else if (op === '<=')
    this.branch.push({ t: 'le', f: 'g' });
  else if (op === '==')
    this.branch.push({ t: 'e', f: 'ne' });
  else if (op === '!=')
    this.branch.push({ t: 'ne', f: 'e' });
};

X64.prototype.genSmiCompare = function genSmiCompare(instr) {
  var masm = this.masm();
  var op = instr.inputs[0].value;
  var left = instr.inputs[1].id;
  var right = instr.inputs[2].id;

  masm.cmp(left, right);
  this._branchOp(op);
};

X64.prototype.genSmiTest = function genSmiTest(instr) {
  var masm = this.masm();
  var left = instr.inputs[0].id;
  var right = instr.inputs[1].id;

  masm.test(left, right);

  // != 0
  this._branchOp('!=');
};

X64.prototype.genSmiShl = function genSmiShl(instr) {
  var masm = this.masm();
  var src = instr.inputs[0].id;
  var shift = instr.inputs[1].id;
  var dst = instr.output.id;

  if (dst !== src)
    masm.mov(dst, src);
  masm.shr(shift, heap.tagShift);
  masm.shl(dst, shift);
  masm.shl(shift, heap.tagShift);
};

X64.prototype.genSmiMax = function genSmiMax(instr) {
  var masm = this.masm();
  var left = instr.inputs[0].id;
  var right = instr.inputs[1].id;
  var dst = instr.output.id;

  masm.cmp(left, right);
  masm.cmov('g', dst, left);
  masm.cmov('le', dst, right);
};

X64.prototype.genSmiUntag = function genSmiUntag(instr) {
  var masm = this.masm();
  var src = instr.inputs[0].id;
  var dst = instr.output.id;

  if (dst !== src)
    masm.mov(dst, src);
  masm.shr(dst, heap.tagShift);
};

X64.prototype.genCheckOverflow = function genCheckOverflow(instr) {
  this.branch.push({ t: 'o', f: 'no' });
};

X64.prototype.genNop = function genNop(instr) {
  var input = this._getSlot(instr.inputs[0]);
  var output = this._getSlot(instr.output);
  if (input !== output || input[1] !== output[1])
    this.masm().mov(output, input);
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

X64.prototype.genCode = function genCode(instr) {
  var masm = this.masm();

  var fn = this.ctx.compiler.blocks[instr.inputs[0].value];
  masm.mov(instr.output.id, fn.code().ptr());
  this.ctx.addReference(masm.getOffset());
};

X64.prototype.genMap = function genMap(instr) {
  var masm = this.masm();

  var map = this.heap.maps[instr.inputs[0].value];
  masm.mov(instr.output.id, map.ptr());
  this.ctx.addReference(masm.getOffset());
};

X64.prototype.genHole = function genHole(instr) {
  var masm = this.masm();

  masm.mov(instr.output.id, this.heap.hole.ptr());
  this.ctx.addReference(masm.getOffset());
};

X64.prototype.genReadTagged = function genReadTagged(instr) {
  var dst = instr.output.id;
  var src = instr.inputs[0].id;
  var off = instr.inputs[1].value;

  var masm = this.masm();
  masm.mov(dst, masm.heapPtr(src, off));
};

X64.prototype.genWriteTagged = function genWriteTagged(instr) {
  var dst = instr.inputs[0].id;
  var src = instr.inputs[1].id;
  var off = instr.inputs[2].value;

  var masm = this.masm();
  masm.mov(masm.heapPtr(dst, off), src);
};

X64.prototype.genCleanupRegs = function genCleanupRegs(instr) {
  var dst = instr.output.id;
  var src = instr.inputs[0].id;

  var masm = this.masm();
  if (dst !== src)
    masm.mov(dst, src);

  this.registers.forEach(function(reg) {
    if (reg !== dst)
      masm.xor(reg, reg);
  });
};

X64.prototype.genCheckMap = function genCheckMap(instr) {
  var masm = this.masm();

  var map = instr.inputs[1].value;
  masm.stub(this.scratch, 'checkMap/' + map, instr.inputs[0].id);
};

X64.prototype.genPushArg = function genPushArg(instr) {
  var masm = this.masm();

  var slot = this._getSlot(instr.inputs[0]);
  masm.push(slot);
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

X64.prototype.genHeapCurrent = function genHeapCurrent(instr) {
  var Context = heap.entities.Context;
  var masm = this.masm();

  var out = instr.output.id;
  masm.mov(out, masm.heapPtr(this.context, Context.offsets.heap));
  masm.mov(out, masm.heapPtr(out, 0));
};

X64.prototype.genHeapSetCurrent = function genHeapSetCurrent(instr) {
  var Context = heap.entities.Context;
  var masm = this.masm();

  var src = instr.inputs[0].id;
  var tmp = instr.scratch[0].id;
  masm.mov(tmp, masm.heapPtr(this.context, Context.offsets.heap));
  masm.mov(masm.heapPtr(tmp, 0), src);
};

X64.prototype.genHeapLimit = function genHeapLimit(instr) {
  var Context = heap.entities.Context;
  var masm = this.masm();

  var out = instr.output.id;
  masm.mov(out, masm.heapPtr(this.context, Context.offsets.heapLimit));
  masm.mov(out, masm.heapPtr(out, 0));
};

X64.prototype.genHeapAlignSize = function genHeapAlignSize(instr) {
  var masm = this.masm();
  var src = instr.inputs[0].id;
  var dst = instr.output.id;

  assert.equal(heap.align & ~(heap.align - 1), heap.align,
               'alignment not a power of two');
  if (dst !== src)
    masm.mov(dst, src);

  masm.labelScope(function() {
    masm.test(dst, heap.align - 1);
    masm.j('z', 'aligned');

    masm.or(dst, heap.align - 1);
    masm.inc(dst);

    masm.bind('aligned');
  });
};

X64.prototype.genPointerAdd = function genPointerAdd(instr) {
  var masm = this.masm();
  var dst = instr.output.id;
  var left = instr.inputs[0].id;
  var right = instr.inputs[1].id;

  if (dst === right) {
    masm.add(right, left);
  } else {
    if (dst !== left)
      masm.mov(dst, left);
    masm.add(dst, right);
  }
};

X64.prototype.genPointerCompare = function genPointerCompare(instr) {
  var masm = this.masm();
  var op = instr.inputs[0].value;
  var left = instr.inputs[1].id;
  var right = instr.inputs[2].id;

  masm.cmp(left, right);
  this._branchOp(op);
};

X64.prototype.genPointerFill = function genPointerFill(instr) {
  var masm = this.masm();
  var start = instr.inputs[0].id;
  var end = instr.inputs[1].id;
  var value = instr.inputs[2].id;
  var scratch = instr.scratch[0].id;

  var self = this;
  masm.labelScope(function() {
    masm.mov(scratch, start);

    masm.bind('start');
    masm.cmp(scratch, end);
    masm.j('ge', 'end');

    masm.mov(masm.heapPtr(scratch, 0), value);
    masm.add(scratch, self.ptrSize);
    masm.j('start');

    masm.bind('end');
  });
};

X64.prototype.genGoto = function genGoto(succ, next) {
  var branch = this.branch.pop();

  if (succ.length === 0)
    return;

  var masm = this.masm();
  if (succ.length === 1) {
    if (succ[0] !== next)
      masm.jl(succ[0]);
    return;
  }

  var left = succ[0];
  var right = succ[1];

  assert.equal(succ.length, 2);
  if (succ[0] === next) {
    masm.jl(branch ? branch.f : 'ne', succ[1]);
  } else if (succ[1] === next) {
    masm.jl(branch ? branch.t : 'e', succ[0]);
  } else {
    masm.jl(branch ? branch.t : 'e', succ[0]);
    masm.jl(branch ? branch.f : 'ne', succ[1]);
  }
};
