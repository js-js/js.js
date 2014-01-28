var assert = require('assert');
var ref = require('ref');
var js = require('../');

describe('Heap', function() {
  var h;
  beforeEach(function() {
    h = new js.heap.Heap();
  });

  describe('raw allocation', function() {
    it('should allocate raw bytes', function() {
      var buf = h.spaces.data.young.allocate(123);
      assert.equal(buf.length, 123);
    });

    it('should allocate big raw bytes', function() {
      var buf = h.spaces.data.young.allocate(10 * 1024 * 1024);
      assert.equal(buf.length, 10 * 1024 * 1024);
    });

    it('should reuse existing pages', function() {
      var a = h.spaces.data.young.allocate(10 * 1024 * 1024);
      var b = h.spaces.data.young.allocate(500 * 1024);
      assert.equal(a.length, 10 * 1024 * 1024);
      assert.equal(b.length, 500 * 1024);
    });
  });

  describe('object allocation', function() {
    it('should allocate number', function() {
      var num = h.allocateNumber(135.89);
      var val = ref.get(num, h.valueOffset, 'double');
      assert.equal(val, 135.89);
    });

    it('should allocate code', function() {
      var code = h.allocateCode(128, 8, 7);
      assert.equal(code.length, 256);
    });

    it('should allocate context', function() {
      var a = h.allocateContext(null, 10);
      var b = h.allocateContext(a, 32);
      assert.equal(a.address(), ref.get(b, h.valueOffset, 'pointer').address());
    });

    it('should allocate function', function() {
      var ctx = h.allocateContext(null, 10);
      var code = h.allocateCode(128);
      var fn = h.allocateFn(ctx, code);
    });
  });
});
