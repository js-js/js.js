function IC(platform, stub) {
  this.platform = platform;
  this.config = stub.ic;
  this.type = this.config.type;
  this.fn = null;
}
exports.IC = IC;

IC.prototype.ptr = function ptr() {
  return this.fn.ptr();
};

exports.extend = function extend(Base) {
};
