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
   it('should do basic unary expression', function() {
      var fn = compile(function() { -1 });
      r.heap.gc();
      assert.equal(fn.call(null, []).cast().value(), -1);
    });

    it('should do basic binary expression', function() {
      var fn = compile(function() {
        (1 * 2) + (-3 - 6);
      });
      r.heap.gc();
      assert.equal(fn.call(null, []).cast().value(), -7);
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
      var global = r.heap.state.global().cast();
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
        false ? 5 + 6 : 7 + 8;
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 15);

      var fn = compile(function() {
        123 ? 9 + 10 : 11 + 12;
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 19);

      var fn = compile(function() {
        0 ? 12 + 13 : 14 + 15;
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 29);
    });

    it('should compile global for loop', function() {
      var fn = compile(function() {
        for (var i = 0; i < 1000000; i++) {};
        i;
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 1000000);
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

    it('should alloc and nested call function', function() {
      var fn = compile(function() {
        function sum(a, b) {
          return a + b;
        }
        sum(sum(1, 2), sum(3, 4))
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 10);
    });

    it('should alloc and call anonymous function', function() {
      var fn = compile(function() {
        (function () {
          return 1;
        })();
      });
      r.heap.gc();
      var res = fn.call(null, []).cast();
      assert.equal(res.value(), 1);
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

    describe('new call', function() {
      it('should construct with 2-args', function() {
        var fn = compile(function() {
          function A(a0, a1, a2) {
            this.a0 = a0;
            this.a1 = a1;
            this.a2 = a2;
          }
          A.prototype.x = 100;
          a = new A(1, 2);
          a.x + a.a0 + a.a1
        });
        r.heap.gc();
        var res = fn.call(null, []).cast();
        assert(res.value(), 103);
      });

      it('should construct with 3-args', function() {
        var fn = compile(function() {
          function A(a0, a1, a2) {
            this.a0 = a0;
            this.a1 = a1;
            this.a2 = a2;
          }
          A.prototype.x = 100;
          a = new A(1, 2, 3);
          a.x + a.a0 + a.a1 + a.a2
        });
        r.heap.gc();
        var res = fn.call(null, []).cast();
        assert(res.value(), 106);
      });

      it('should evolve proto', function() {
        var fn = compile(function() {
          function A() {
          }
          A.prototype.x = 40;
          a = new A();
          A.prototype.y = 2;
          a.x + a.y
        });
        r.heap.gc();
        var res = fn.call(null, []).cast();
        assert(res.value(), 42);
      });

      it('should support proto chains', function() {
        var fn = compile(function() {
          function A() {}
          A.prototype.aprop = 40;
          function B() {}
          B.prototype = new A();
          B.prototype.bprop = 2;
          var b = new B();
          b.aprop + b.bprop
        });
        r.heap.gc();
        var res = fn.call(null, []).cast();
        assert(res.value(), 42);
      });

      it('should support instanceof', function() {
        var fn = compile(function() {
          function A() {}
          var a = new A();
          a instanceof A
        });
        r.heap.gc();
        assert.equal(fn.call().cast().value(), true);

        var fn = compile(function() {
          function A() {}
          function B() {}
          var a = new A();
          a instanceof B
        });
        r.heap.gc();
        assert.equal(fn.call().cast().value(), false);

        var fn = compile(function() {
          function A() {}
          function B() {}
          B.prototype = new A();
          var a = new B();
          a instanceof A
        });
        r.heap.gc();
        assert.equal(fn.call().cast().value(), true);
      });
    });
  });

  describe('accessor', function() {
    it('should call getter/setter', function() {
      var getter = compile(function() {
        (function() {
          return 123000;
        });
      }).call(null, []);
      var setter = compile(function() {
        (function(value) {
          this.another = value;
        });
      }).call(null, []);
      r.heap.gc();

      var obj = r.heap.allocObject();
      var access = r.heap.allocAccessPair({ getter: getter, setter: setter });
      obj.set(r.heap.allocString('some'), access);

      var global = r.heap.state.global().cast();
      global.set(r.heap.allocString('obj'), obj);

      var fn = compile(function() {
        obj.some = 456;
        obj.some + obj.another;
      });
      assert(fn.call(null, []).cast().value(), 123456);
    });
  });
});
