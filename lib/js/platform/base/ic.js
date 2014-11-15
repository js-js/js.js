var graph = require('cfg-graph');

function IC(platform, stub) {
  this.platform = platform;
  this.stub = stub;
  this.type = this.stub.ic;
  this.fn = null;
}
exports.IC = IC;

IC.prototype.getCFG = function getCFG() {
  var g = graph.create();

  var b = g.block('IC');

  // Miss
  b.add('beginProc');
  var args = [];
  for (var i = 0; i < this.stub.argc; i++)
    args.push(b.add('loadStubArg', g.js(i)));

  for (var i = args.length - 1; i >= 0; i--)
    b.add('pushArg', args[i]);
  var res = b.add('callStub', [ g.js(this.stub.name), g.js(args.length) ]);
  b.add('ret', res);

  return g.toJSON();
};

IC.prototype.generate = function generate() {
  var compiler = this.platform.ctx.compiler;

  this.fn = compiler.compileCFG(this.getCFG(), {
    type: 'ic',
    locals: {
      stub: this.stub.name
    }
  });
};

IC.prototype.ptr = function ptr() {
  return this.fn.ptr();
};

function functionToIC(fn) {
};

exports.extend = function extend(Base) {
  Base.prototype.functionToIC = functionToIC;
};
