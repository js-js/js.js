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

  if (this.subtype === 'normal')
    this.Probes = GetPropertySlot.NormalProbes;
  else
    this.Probes = GetPropertySlot.FixedProbes;
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
  var Base = heap.entities.Base;
  var g = graph.create();

  var b = g.block('IC');
  var ic = b.add('ic');

  var args = {
    obj: b.add('loadICArg', g.js(0)),
    property: null,
    mapx: null
  };
  if (this.subtype === 'normal')
    args.property = b.add('loadICArg', g.js(1));
  args.map = b.add('readTagged', [ args.obj, g.js(Base.offsets.map) ]);

  // Probes
  b = probes.generate(g, b, args);

  // Miss
  b.add('tailCallStub', [ g.js('getPropertySlot_Miss'), ic ]);

  return g.toJSON();
};

GetPropertySlot.prototype.generate = function generate(probes) {
  if (!probes)
    probes = new this.Probes([]);

  var compiler = this.platform.compiler;

  var fn = compiler.compileCFG(this.getCFG(probes), { type: 'ic' });

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
  if (!map.isObject() || !map.canTransition())
    return;

  var probes = this.getProbes();
  probes.append(map, prop, result);

  this.generate(probes);
};

function Probes(type, list) {
  this.type = type;
  this.list = list || [];
  this.length = this.list.length;
  this.itemSize = 1;

  this.ctx = null;
}
GetPropertySlot.Probes = Probes;

Probes.prototype.count = function count() {
  return this.length / this.itemSize;
};

Probes.prototype.generate = function generate(g, start, args) {
  var count = this.count();
  var b = start;

  this.ctx = {
    g: g,
    args: args,
    index: 0
  };
  this.forEach(function(map, property, value, index) {
    var last = index === count - 1;

    var mapOut = this.generateMap(b, map);
    var propOut = this.generateProperty(mapOut.hit, property);
    this.generateHit(propOut.hit, value);

    if (mapOut.miss && propOut.miss)
      mapOut.miss.go(propOut.miss);

    b = mapOut.miss || propOut.miss;
  }, this);
  this.ctx = null;

  return b;
};

Probes.prototype.generateMap = function generateMap(b, map) {
  if (!map)
    return { hit: b, miss: null };

  var g = this.ctx.g;

  var actual = this.ctx.args.map;
  var expected = b.add('pointer', [ g.js('weak'), g.js(map.ptr()) ]);
  b.add('pointerCompare', [ g.js('=='), actual, expected ]);

  var hit = g.block();
  var miss = g.block();
  b.go(hit);
  b.go(miss);

  return { hit: hit, miss: miss };
};

Probes.prototype.generateProperty = function generateProperty(b, property) {
  if (!property)
    return { hit: b, miss: null };

  var g = this.ctx.g;

  // Compare properties
  var actual = args.property;
  var expected = b.add('pointer', [ g.js('weak'), g.js(property.ptr()) ]);
  b.add('pointerCompare', [ g.js('=='), actual, expected ]);

  var hit = g.block();
  var miss = g.block();
  b.go(hit);
  b.go(miss);

  return { hit: hit, miss: miss };
};

Probes.prototype.generateHit = function generateHit(b, value) {
  var g = this.ctx.g;

  var resPtr = b.add('pointer', [ g.js('weak'), g.js(value.ptr()) ]);
  b.add('icRet', resPtr);
};

function NormalProbes(list) {
  Probes.call(this, 'normal', list);

  this.itemSize = 3;
}
GetPropertySlot.NormalProbes = NormalProbes;
util.inherits(NormalProbes, Probes);

NormalProbes.prototype.forEach = function forEach(cb, ctx) {
  for (var i = 0, index = 0; i < this.length; i += 3, index++)
    cb.call(ctx, this.list[0], this.list[1], this.list[2], index);
};

NormalProbes.prototype.append = function append(map, property, value) {
  this.list.push(map, property, value);
  this.length += this.itemSize;
};

function FixedProbes(list) {
  Probes.call(this, 'fixed', list);

  this.itemSize = 2;
}
GetPropertySlot.FixedProbes = FixedProbes;
util.inherits(FixedProbes, Probes);

FixedProbes.prototype.forEach = function forEach(cb, ctx) {
  for (var i = 0, index = 0; i < this.length; i += 2, index++)
    cb.call(ctx, this.list[0], null, this.list[1], index);
};

FixedProbes.prototype.append = function append(map, property, value) {
  this.list.push(map, value);
  this.length += this.itemSize;
};
