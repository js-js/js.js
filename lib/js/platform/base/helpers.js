var assert = require('assert');
var heap = require('heap.js');

assert.equal(heap.tagPointer, heap.tagMask);

exports.heapPtr = function heapPtr(base, off) {
  return [ base, off - heap.tagPointer ];
};
