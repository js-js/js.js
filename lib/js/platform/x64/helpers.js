var assert = require('assert');
var heap = require('heap.js');

assert.equal(heap.tagPointer, heap.tagMask);

exports.isSmi = function isSmi(value) {
  this.test(value, heap.tagPointer);
};

exports.untagSmi = function untagSmi(value) {
  this.shr(value, heap.tagShift);
};

exports.tagSmi = function tagSmi(value) {
  this.shl(value, heap.tagShift);
};

exports.movSmi = function movSmi(dst, value) {
  this.mov(dst, value << heap.tagShift);
};

exports.alignedCall = function alignedCall(src) {
  var len = (this.getHigh(src) === 0 ? 0 : 1) + 2;
  while (((this.getOffset() + len) & heap.tagPointer) != heap.tagSmi)
    this.nop();
  this.call(src);
};
