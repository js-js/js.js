var js = require('../../../../js');

function Base(platform, fn) {
  this.platform = platform;
  this.fn = fn;
}
module.exports = Base;

Base.prototype.ptr = function ptr() {
  if (this.fn === null)
    this.generate();
  return this.fn.ptr();
};

Base.prototype.getProbes = function getProbes() {
  return this.fn.code().weakReferences();
};

Base.extend = function extend(Platform) {
  Platform.prototype.getIC = getIC;
}

function getIC(type, fn) {
  if (!fn)
    fn = null;
  if (type === 'getPropertySlot')
    return new js.platform.base.ic.GetPropertySlot(this, fn, 'normal');
  else if (type === 'getFixedPropertySlot')
    return new js.platform.base.ic.GetPropertySlot(this, fn, 'fixed');
  else
    throw new Error('Unknown IC type: ' + type);
};
