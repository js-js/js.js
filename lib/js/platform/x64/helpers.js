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
