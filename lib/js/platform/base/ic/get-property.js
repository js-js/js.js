var js = require('../../../../js');
var Base = js.platform.base.ic.Base;

var assert = require('assert');
var heap = require('heap.js');
var graph = require('cfg-graph');
var util = require('util');

function GetPropertySlot(platform, fn, subtype) {
  Base.call(this, platform, fn);
  this.subtype = subtype;

  // Restore subtype from the function object
  if (this.fn !== null) {
    var off = this.fn.heap.smi(GetPropertySlot.offsets.subtype);
    var subIndex = this.fn.get(off).cast().value();
    this.subtype = GetPropertySlot.subTypes[subIndex];
  }
}
util.inherits(GetPropertySlot, Base);
module.exports = GetPropertySlot;

GetPropertySlot.offsets = {
  subtype: 0
};

GetPropertySlot.subTypes = {
  0: 'normal',
  1: 'fixed'
};

GetPropertySlot.revSubTypes = {
  normal: 0,
  fixed: 1
};

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
    // Store subtype
    var prop = fn.heap.smi(GetPropertySlot.offsets.subtype);
    var value = fn.heap.smi(GetPropertySlot.revSubTypes[this.subtype]);
    fn.set(prop, value);

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
