var heap = require('heap.js');

exports.extend = function extend(X64) {
  X64.prototype.genICMiss = genICMiss;
};

function genICMiss(instr) {
  var masm = this.masm();
  var Function = heap.entities.Function;
  var Code = heap.entities.Code;

  var stub =  this.getStub(instr.inputs[0].value);
  masm.mov(this.scratch, stub.ptr());
  this.ctx.addReference(masm.getOffset());

  masm.mov(this.scratch,
           masm.heapPtr(this.scratch, Function.offsets.code));
  masm.lea(this.scratch,
           masm.heapPtr(this.scratch, Code.offsets.code));
  masm.tailCall(this.scratch);
}
