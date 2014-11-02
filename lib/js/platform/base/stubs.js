var heap = require('heap.js');

exports.init = function init() {
  propertyStubs.call(this);
  allocStubs.call(this);
  binaryStubs.call(this);
};

function propertyStubs() {
  this.declareCFGStub('storeProperty', function() {/*
    block StoreProperty
      obj = loadStubArg %0
      prop = loadStubArg %1
      value = loadStubArg %2
      rtId = runtimeId %"storeProperty"
      rt = runtime

      pushArg value
      pushArg prop
      pushArg obj
      pushArg rtId

      res = callStub rt, %4
      ret res
  */});

  this.declareCFGStub('loadProperty', function() {/*
    block LoadProperty
      obj = loadStubArg %0
      prop = loadStubArg %1
      rtId = runtimeId %"loadProperty"
      rt = runtime

      pushArg prop
      pushArg obj
      pushArg rtId

      res = callStub rt, %3
      ret res
  */});

  this.declareCFGStub('deleteProperty', function() {/*
    block DeleteProperty
      i1 = literal %undefined
      ret i1
  */});
}

function allocStubs() {
  var Base = heap.entities.Base;
  var Object = heap.entities.Object;
  var Function = heap.entities.Function;

  this.declareCFGStub('allocObject', function() {/*
    block AllocObject
      size = loadStubArg %0
      hashmap = allocHashMap size

      t2 = stub %"allocTagged/object"
      t1 = literal %{size}
      pushArg t1
      obj = callStub t2, %1

      writeTagged obj, hashmap, %{hmOff}
      ret obj
  */}, {
    hmOff: Object.offsets.hashmap,
    size: Object.size()
  });

  this.declareCFGStub('allocFn', function() {/*
    block AllocFn
      size = literal %0
      hashmap = allocHashMap size

      t2 = stub %"allocTagged/function"
      t1 = literal %{size}
      pushArg t1
      fn = callStub t2, %1

      code = loadStubArg %0
      writeTagged fn, hashmap, %{hmOff}
      writeTagged fn, code, %{codeOff}

      // prototype
      proto = object %0
      prop = literal %"prototype"

      // NOTE: storeProperty is replaced with a stub call here
      storeProperty fn, prop, proto

      ret fn
  */}, {
    hmOff: Object.offsets.hashmap,
    codeOff: Function.offsets.code,
    size: Function.size()
  });

  var types = [
    'boolean',
    'hashmap',
    'object',
    'function'
  ];
  types.forEach(function(type) {
    this.declareCFGStub('allocTagged/' + type, function() {/*
      block AllocTagged -> B1, B2
        size = loadStubArg %0
        asize = heap.alignSize size

        current = heap.current
        limit = heap.limit
        after = pointerAdd current, asize
        pointerCompare %"<=", after, limit

      block B1
        heap.setCurrent after
        map = map %{type}
        writeTagged current, map, %{mapOff}
        ret current

      block B2
        // Allocation not possible at the time
        // TODO(indutny): call runtime
        brk
    */}, {
      type: type,
      mapOff: Base.offsets.map
    });
  }, this);
}

function binaryStubs() {
  var ops = [ '+', '-', '*' ];
  ops.forEach(function(op) {
    this.declareCFGStub('binary/' + op, function() {/*
      block BinaryMath -> B1, B2
        left = loadStubArg %0
        isSmi left

      block B1 -> B3, B4
        right = loadStubArg %1
        isSmi right

      block B3 -> B5, B6
        // both smis
        #if op === '+'
          r = smiAdd left, right
        #elif op === '-'
          r = smiSub left, right
        #elif op === '*'
          r = smiMul left, right
        #endif
        checkOverflow

      block B6
        ret r

      block B2 -> B4
      block B4 -> B5
      block B5
        // not smis
        brk
    */}, {
      op: op
    });
  }, this);

  var ops = [ '<', '<=' ];
  ops.forEach(function(op) {
    this.declareCFGStub('binary/' + op, function() {/*
      block BinaryLogic -> B1, B2
        left = loadStubArg %0
        isSmi left

      block B1 -> B3, B4
        right = loadStubArg %1
        isSmi right

      block B3 -> B5, B6
        // both smis
        #if op === '<'
          smiCompare %"<", left, right
        #elif op === '<='
          smiCompare %"<=", left, right
        #endif

      block B5
        r0 = literal %true
        ret r0

      block B6
        r1 = literal %false
        ret r1

      block B2 -> B4
      block B4
        // not smis
        brk
    */}, {
      op: op
    });
  }, this);
}
