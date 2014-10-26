var assert = require('assert');
var js = require('../');

var heap = require('heap.js');

var options = {
  trace: process.env.JS_TRACE,
  brk: process.env.JS_BRK
};

describe('js.js API', function() {
  var r;
  beforeEach(function() {
    r = js.create(options);
  });

  function compile(code) {
    var input = code.toString().replace(/^function[^{]*{|}$/g, '')
    return r.compile(input);
  }

  describe('basics', function() {
    it('should do basic binary expression', function() {
      var fn = compile(function() {
        (1 * 2) + (3 - 6);
      });
      r.heap.gc();
      assert.equal(fn.call(null, []).cast().value(), -1);
    });

    it('should do basic binary with spills', function() {
      var fn = compile(function() {
        1 + (2 + (3 + (4 + (5 + (6 +
            (7 + (8 + (9 + (10 + (11 + (12 +
            (13 + 14))))))))))));
      });
      r.heap.gc();
      assert.equal(fn.call(null, []).cast().value(), 105);
    });

    it('should do basic binary logic', function() {
      var fn = compile(function() { 1 < 2; });
      assert.equal(fn.call(null, []).cast().value(), true);
      var fn = compile(function() { 2 < 2; });
      assert.equal(fn.call(null, []).cast().value(), false);
      var fn = compile(function() { 2 <= 2; });
      assert.equal(fn.call(null, []).cast().value(), true);
      var fn = compile(function() { 3 <= 2; });
      assert.equal(fn.call(null, []).cast().value(), false);
    });

    it('should do string literal', function() {
      var fn = compile(function() { "okish"; });
      r.heap.gc();
      assert.equal(fn.call(null, []).cast().toString(), 'okish');
    });
  });

  describe('global', function() {
    it('should do global fetch', function() {
      var global = r.heap.context.global().cast();
      global.set(r.heap.allocString('ohai'), r.heap.allocString('ok'));

      var fn = compile(function() { ohai; });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.toString(), 'ok');
    });

    it('should do global store', function() {
      var fn = compile(function() { ohai = "oook"; ohai; });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.toString(), 'oook');
    });

    it('should do global undefined load', function() {
      var fn = compile(function() { ohai; });
      r.heap.gc();
      var res = fn.call(null, []);
      assert(r.heap.isUndef(res));
    });

    it('should do math with globals', function() {
      var fn = compile(function() {
        var a = 1, b = 2, c = 3;
        (a + c)  + (b + c);
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 9);
    });
  });

  describe('allocator', function() {
    it('should allocate object', function() {
      var fn = compile(function() {
        var a = {};
        a.x = "ok";
        a.x;
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.toString(), 'ok');
    });
  });

  describe('control flow', function() {
    it('should compile empirenode example', function() {
      var fn = compile(function() {
        function test(a, b) {
          var r;
          if (a < b)
            r = 1;
          else
            r = 2;
          return r;
        }
        test(3, 2);
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 2);
    });

    it('should compile conditional', function() {
      var fn = compile(function() {
        true ? 1 + 2 : 3 + 4;
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 3);

      var fn = compile(function() {
        false ? 1 + 2 : 3 + 4;
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 7);

      var fn = compile(function() {
        123 ? 1 + 2 : 3 + 4;
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 3);

      var fn = compile(function() {
        0 ? 1 + 2 : 3 + 4;
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 7);
    });

    it('should compile global for loop', function() {
      var fn = compile(function() {
        for (var i = 0; i < 1000; i++) {};
        i;
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 1000);
    });

    it('should compile local for loop', function() {
      var fn = compile(function() {
        function run() {
          for (var i = 0; i < 1000000; i++) {};
          return i;
        }
        run();
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 1000000);
    });


    it('should compile global nested for loop', function() {
      var fn = compile(function() {
        var k = 0;
        for (var i = 0; i < 10; i++)
          for (var j = 0; j < 10; j++)
            k++;
        k;
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 100);
    });

    it('should compile local nested for loop', function() {
      var fn = compile(function() {
        function run() {
          var k = 0;
          for (var i = 0; i < 1000; i++)
            for (var j = 0; j < 1000; j++)
              k++;
          return k;
        }
        run();
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 1000000);
    });
  });

  describe('functions', function() {
    it('should alloc and call function', function() {
      var fn = compile(function() {
        function sum(a, b, c) {
          return a + b + c;
        }
        sum(1 + 1, 2 + 2, 3 + 3);
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 12);
    });

    it('should return undefined for argv OOB', function() {
      var fn = compile(function() {
        function third(a, b, c) {
          return c;
        }
        third(1, 2);
      });
      r.heap.gc();
      var res = fn.call(null, []);
      assert(r.heap.isUndef(res));
    });

    it('should have global as `this`', function() {
      var fn = compile(function() {
        function setGlobal() {
          this.xyz = 13589;
        }
        setGlobal();
        xyz;
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert(res.value(), 13589);
    });

    it('should have object as `this`', function() {
      var fn = compile(function() {
        var obj = {
          method: function method() {
            this.xyz = 13589;
          }
        };
        obj.method();
        obj.xyz;
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert(res.value(), 13589);
    });

    it('should see itself', function() {
      var fn = compile(function() {
        function call(fn, arg) {
          return fn(arg);
        }
        call(function factorial(n) {
          if (n <= 1)
            return 1;
          return n * factorial(n - 1);
        }, 5);
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert(res.value(), 120);
    });
  });
});
