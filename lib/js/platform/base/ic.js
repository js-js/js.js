function IC(platform, stub) {
  this.platform = platform;
  this.stub = stub;
  this.type = this.stub.ic;
  this.fn = null;
}
exports.IC = IC;

IC.prototype.generate = function generate() {
  var compiler = this.platform.ctx.compiler;

  this.fn = compiler.compileCFG(function() {/*
    block IC
      ICMiss %{stub}
  */}, {
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
