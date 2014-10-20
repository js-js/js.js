var js = require('../js');
var heap = require('heap.js');

function Runtime(options) {
  this.heap = heap.create();
  this.compiler = new js.Compiler(this);
}
module.exports = Runtime;

Runtime.create = function create(options) {
  return new Runtime(options);
};

Runtime.prototype.compile = function compile(code) {
  return this.compiler.compile(code);
};
