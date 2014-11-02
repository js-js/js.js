var assert = require('assert');
var heap = require('heap.js');

exports.init = function init() {
  var self = this;

  var types = [
    'boolean',
    'hashmap',
    'object',
    'function'
  ];
  types.forEach(function(type) {
    var Base = heap.entities.Base;

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
};
