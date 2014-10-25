var assert = require('assert');
var heap = require('heap.js');

exports.init = function init() {
  var self = this;

  [
    '+', '-', '*',
    '<'
  ].forEach(function(op) {
    this.stubs.define('binary/' + op, function(left, right) {
      this.isSmi(left);
      this.j('nz', 'non-smi');
      this.isSmi(right);
      this.j('nz', 'non-smi');

      // Both SMIs
      this.mov('rax', left);
      if (op === '+' || op === '-' || op === '*') {
        if (op === '+')
          this.add('rax', right);
        else if (op === '-')
          this.sub('rax', right);
        else if (op === '*')
          this.mul(right);
        this.j('o', 'overflow');

        if (op === '*')
          this.untagSmi('rax');
        this.Return();

        // TODO(indutny): convert to doubles
        this.bind('overflow');
        this.runtime(function() {
          console.error('binary/' + op + ' overflow');
        });
        this.int3();
        this.Return();
      } else if (op === '<') {
        this.cmp('rax', right);
        this.j('g', 'false');

        this.bind('true');
        this.mov('rax', self.heap.true_.ptr());
        this.ctx.addReference(this.getOffset());
        this.Return();

        this.bind('false');
        this.mov('rax', self.heap.false_.ptr());
        this.ctx.addReference(this.getOffset());
        this.Return();
      } else {
        throw new Error('Unknown op: ' + op);
      }

      // TODO(indutny): invoke runtime
      this.bind('non-smi');
      this.runtime(function() {
        console.error('binary/' + op + ' non-smi case');
      });
      this.int3();
      this.Return();
    });
  }, this);

  this.stubs.define('loadProperty', function(obj, prop) {
    this.runtime(function(obj, prop) {
      return self.heap.scope(function() {
        obj = self.heap.wrapPtr(obj).cast();
        prop = self.heap.wrapPtr(prop).cast();

        return obj.get(prop).ptr();
      });
    }, obj, prop);
    this.Return();
  });

  this.stubs.define('storeProperty', function(obj, prop, val) {
    this.runtime(function(obj, prop, val) {
      self.heap.scope(function() {
        obj = self.heap.wrapPtr(obj).cast();
        prop = self.heap.wrapPtr(prop).cast();
        val = self.heap.wrapPtr(val);

        obj.set(prop, val);
      });
      return 0;
    }, obj, prop, val);
    this.Return();
  });

  var types = [
    'boolean',
    'hashmap',
    'object',
    'function'
  ];
  types.forEach(function(type) {
    var Base = heap.entities.Base;

    this.stubs.define('allocTagged/' + type, function(ctx, size) {
      var Context = heap.entities.Context;
      var handle = self.heap.maps[type];

      this.spill([ 'rbx', 'rcx', 'rdx' ], function() {
        this.mov('rbx', ctx);
        this.mov('rcx', this.heapPtr('rbx', Context.offsets.heap));
        this.mov('rdx', this.heapPtr('rbx', Context.offsets.heapLimit));

        // loc = *(void**) loc
        this.mov('rbx', this.heapPtr('rcx', 0));
        this.mov('rdx', this.heapPtr('rdx', 0));

        // Align size
        assert.equal(heap.align & ~(heap.align - 1), heap.align,
                     'alignment not a power of two');
        this.mov('rax', size);
        this.test('rax', heap.align - 1);
        this.j('z', 'aligned');

        this.or('rax', heap.align - 1);
        this.inc('rax');

        this.bind('aligned');

        this.add('rax', 'rbx');
        this.cmp('rax', 'rdx');
        this.j('g', 'gc-required');

        // Update page
        this.mov(this.heapPtr('rcx', 0), 'rax');
        this.mov('rax', 'rbx');

        // Set map
        this.mov('rbx', handle.ptr());
        this.ctx.addReference(this.getOffset());

        this.mov(this.heapPtr('rax', Base.offsets.map), 'rbx');

        this.Return();

        // TODO(indutny): implement it
        this.bind('gc-required');
        this.runtime(function() {
          console.error('GC required for allocation');
        });
        this.int3();
        this.Return();
      });
    });

    this.stubs.define('coerce/' + type, function(value) {
      var handle = self.heap.maps[type];

      this.spill([ 'rbx' ], function() {
        this.mov('rbx', handle.ptr());
        this.ctx.addReference(this.getOffset());
        this.mov('rax', value);

        // TODO(indunty): could be handled in-line
        this.isSmi('rax');
        this.j('e', 'call-runtime');

        this.cmp('rbx', this.heapPtr('rax', Base.offsets.map));
        this.j('ne', 'call-runtime');
        this.Return();

        this.bind('call-runtime');
        this.runtime(function(value) {
          return self.heap.scope(function() {
            value = self.heap.wrapPtr(value).cast();

            return value.cast().coerceTo(handle).ptr();
          });
        }, 'rax');
        this.Return();
      });
    });

    this.stubs.define('checkMap/' + type, function(value) {
      var handle = self.heap.maps[type];

      this.spill([ 'rax', 'rbx' ], function() {
        this.mov('rax', value);
        this.isSmi('rax');
        this.j('e', 'bail-out');

        this.mov('rbx', handle.ptr());
        this.ctx.addReference(this.getOffset());
        this.cmp(this.heapPtr('rax', Base.offsets.map), 'rbx');
        this.j('ne', 'bail-out');
        this.Return();

        // TODO(indutny): throw error
        this.bind('bail-out');
        this.runtime(function() {
          console.error('checkMap/' + type + ' failed');
        });
        this.int3();
        this.Return();
      });
    });
  }, this);

  this.stubs.define('holeFill', function(start, len) {
    this.spill([ 'rbx', 'rcx', 'rdx' ], function() {
      this.mov('rbx', start);
      this.mov('rcx', len);
      this.untagSmi('rcx');
      this.add('rcx', 'rbx');
      this.mov('rdx', self.heap.hole.ptr());
      this.ctx.addReference(this.getOffset());

      this.bind('loop');

      this.cmp('rbx', 'rcx');
      this.j('ge', 'done');
      this.mov([ 'rbx', 0 ], 'rdx');
      this.add('rbx', self.ptrSize);
      this.j('loop');

      this.bind('done');
    });
    this.Return();
  });
};
