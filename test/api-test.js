var assert = require('assert');
var js = require('../');

var heap = require('heap.js');

describe('js.js API', function() {
  var r;
  beforeEach(function() {
    r = js.create();
  });

  describe('basics', function() {
    it('should do basic binary expression', function() {
      var fn = r.compile('(1 + 2) + (3 + 4)');
      r.heap.gc();
      assert.equal(fn.call(null, []).cast().value(), 10);
    });

    it('should do string literal', function() {
      var fn = r.compile('"okish"');
      r.heap.gc();
      assert.equal(fn.call(null, []).cast().toString(), 'okish');
    });
  });

  describe('global', function() {
    it('should do global fetch', function() {
      var global = r.heap.context.global().cast();
      global.set(r.heap.allocString('ohai'), r.heap.allocString('ok'));

      var fn = r.compile('ohai');
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.toString(), 'ok');
    });

    it('should do global store', function() {
      var fn = r.compile('ohai = "oook";ohai');
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.toString(), 'oook');
    });

    it('should do global undefined load', function() {
      var fn = r.compile('ohai');
      r.heap.gc();
      var res = fn.call(null, []);
      assert(r.heap.isUndef(res));
    });

    it('should do math with globals', function() {
      var fn = r.compile('var a = 1, b = 2, c = 3; (a + c)  + (b + c)');
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 9);
    });
  });

  describe('allocator', function() {
    it('should allocate object', function() {
      var fn = r.compile('var a = {};a.x = "ok";a.x');
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.toString(), 'ok');
    });
  });

  describe('control flow', function() {
    it('should compile conditional', function() {
      var fn = r.compile('true ? 1 + 2 : 3 + 4');
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 3);

      var fn = r.compile('false ? 1 + 2 : 3 + 4');
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 7);

      var fn = r.compile('123 ? 1 + 2 : 3 + 4');
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 3);

      var fn = r.compile('0 ? 1 + 2 : 3 + 4');
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 7);
    });
  });
});
