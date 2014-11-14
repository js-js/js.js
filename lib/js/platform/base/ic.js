function IC(platform, stub) {
  this.platform = platform;
  this.type = stub.ic;
  this.fn = null;
}
exports.IC = IC;

IC.prototype.ptr = function ptr() {
  return this.fn.ptr();
};

function functionToIC(fn) {
};

exports.extend = function extend(Base) {
  Base.prototype.functionToIC = functionToIC;
};
