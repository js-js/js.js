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

  this.stubs.define('allocObject', function(size) {
    this.runtime(function(size) {
      console.log(size);
      return 0;
    }, size);
    this.Return();
  });
};
