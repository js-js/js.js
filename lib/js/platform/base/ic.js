var assert = require('assert');
var heap = require('heap.js');
var graph = require('cfg-graph');
var util = require('util');

exports.extend = function extend(Base) {
  Base.prototype.getIC = getIC;
}

function getIC(type, fn) {
  if (!fn)
    fn = null;
  if (type === 'getPropertySlot')
    return new GetPropertySlot(this, fn);
  else
    throw new Error('Unknown IC type: ' + type);
};

function Base(platform, fn) {
  this.platform = platform;
  this.fn = fn;
}
exports.Base = Base;

Base.prototype.ptr = function ptr() {
  if (this.fn === null)
    this.generate();
  return this.fn.ptr();
};

Base.prototype.getProbes = function getProbes() {
  return this.fn.code().weakReferences();
};

function GetPropertySlot(platform, fn) {
  Base.call(this, platform, fn);
}
util.inherits(GetPropertySlot, Base);
exports.GetPropertySlot = GetPropertySlot;

GetPropertySlot.prototype.getCFG = function getCFG(probes) {
  if (!probes)
    probes = [];

  var Base = heap.entities.Base;
  var g = graph.create();

  var b = g.block('IC');
  var ic = b.add('ic');

  var args = {
    obj: b.add('loadICArg', g.js(0)),
    prop: b.add('loadICArg', g.js(1))
  };

  if (probes.length !== 0)
    b.go('Probe0');

  var actual = b.add('readTagged', [ args.obj, g.js(Base.offsets.map) ]);

  // Probes
  for (var i = 0, index = 0; i < probes.length; i += 3, index++) {
    b = g.block('Probe' + index);

    var map = probes[i];
    var prop = probes[i + 1];
    var cache = probes[i + 2];

    // Compare maps
    var expected = b.add('pointer', [ g.js('weak'), g.js(map.ptr()) ]);
    b.add('pointerCompare', [ g.js('=='), actual, expected ]);
    b.go('Probe' + index + '_HitMap');
    if (i !== probes.length - 3)
      b.go('Probe' + (index + 1));
    else
      b.go('Miss' + index + '_map');
    b = g.block('Probe' + index + '_HitMap');

    // Compare properties
    var expected = b.add('pointer', [ g.js('weak'), g.js(prop.ptr()) ]);
    b.add('pointerCompare', [ g.js('=='), args.prop, expected ]);
    b.go('Probe' + index + '_HitProp');
    if (i !== probes.length - 3)
      b.go('Probe' + (index + 1));
    else
      b.go('Miss' + index + '_prop');

    b = g.block('Probe' + index + '_HitProp');
    var resPtr = b.add('pointer', [ g.js('weak'), g.js(cache.ptr()) ]);
    b.add('icRet', resPtr);
  }

  for (var i = 0; i < index; i++) {
    b = g.block('Miss' + i + '_map');
    b = g.block('Miss' + i + '_prop');
  }

  // Miss
  b.add('tailCallStub', [ g.js('getPropertySlot_Miss'), ic ]);

  return g.toJSON();
};

GetPropertySlot.prototype.generate = function generate(probes) {
  var compiler = this.platform.compiler;

  var fn = compiler.compileCFG(this.getCFG(probes), {
    type: 'ic'
  });

  if (this.fn === null) {
    this.fn = fn;
    return;
  }

  // Replace code of existing function
  this.fn._setCode(fn.code());
};

GetPropertySlot.prototype.miss = function miss(map, prop, result) {
  if (map.isObject() && map.canTransition())
    this.generate(this.getProbes().concat(map, prop, result));
};
