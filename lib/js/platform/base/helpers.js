var assert = require('assert');
var heap = require('heap.js');

assert.equal(heap.tagPointer, heap.tagMask);

exports.heapPtr = function heapPtr(base, off) {
  if (typeof off === 'number')
    return [ base, off - heap.tagPointer ];
  else
    return [ base, off, -heap.tagPointer ];
};
