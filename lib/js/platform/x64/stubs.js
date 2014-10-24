var assert = require('assert');
var heap = require('heap.js');

exports.init = function init() {
  var self = this;

  this.stubs.define('binary+', function(left, right) {
    this.isSmi(left);
    this.j('nz', 'non-smi');
    this.isSmi(right);
    this.j('nz', 'non-smi');

    // Both SMIs
    this.mov('rax', left);
    this.add('rax', right);
    this.j('o', 'overflow');
    this.Return();

    // TODO(indutny): invoke runtime
    this.bind('non-smi');
    this.int3();
    this.Return();

    // TODO(indutny): convert to doubles
    this.bind('overflow');
    this.int3();
    this.Return();
  });

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

  this.stubs.define('allocTagged', function(ctx, map, size) {
    var Context = heap.entities.Context;
    var Base = heap.entities.Base;

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
      this.mov('rbx', map);
      this.mov(this.heapPtr('rax', Base.offsets.map), 'rbx');

      this.Return();

      // TODO(indutny): implement it
      this.bind('gc-required');
      this.int3();
      this.Return();
    });
  });

  this.stubs.define('fill', function(start, len, value) {
    this.spill([ 'rbx', 'rcx', 'rdx' ], function() {
      this.mov('rbx', start);
      this.mov('rcx', len);
      this.untagSmi('rcx');
      this.add('rcx', 'rbx');
      this.mov('rdx', value);

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

  this.stubs.define('coerce', function(map, value) {
    var Base = heap.entities.Base;

    this.spill([ 'rbx' ], function() {
      this.mov('rbx', map);
      this.mov('rax', value);

      // TODO(indunty): could be handled in-line
      this.isSmi('rax');
      this.j('e', 'call-runtime');

      this.cmp('rbx', this.heapPtr('rax', Base.offsets.map));
      this.j('ne', 'call-runtime');
      this.Return();

      this.bind('call-runtime');
      this.runtime(function(map, value) {
        return self.heap.scope(function() {
          map = self.heap.wrapPtr(map).cast();
          value = self.heap.wrapPtr(value).cast();

          return value.cast().coerceTo(map).ptr();
        });
      }, 'rbx', 'rax');
      this.Return();
    });
  });
};
