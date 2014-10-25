var js = require('../js');
var heap = require('heap.js');

function Runtime(options) {
  this.platform = new js.platform.X64(this);
  this.heap = heap.create({
    callWrapper: this.platform.callWrapper
  });
  this.platform.heap = this.heap;
  this.compiler = new js.Compiler(this, options);
}
module.exports = Runtime;

Runtime.create = function create(options) {
  return new Runtime(options);
};

Runtime.prototype.compile = function compile(code) {
  return this.compiler.compile(code);
};
