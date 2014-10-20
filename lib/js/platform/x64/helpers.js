var assert = require('assert');
var heap = require('heap.js');

exports.isSmi = function isSmi(value) {
  assert.equal(heap.tagPointer, heap.tagMask);
  this.test(value, heap.tagPointer);
};
