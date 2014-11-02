var heap = require('heap.js');

exports.init = function init() {
  propertyStubs.call(this);
  allocStubs.call(this);
  typeStubs.call(this);
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
  var HashMap = heap.entities.HashMap;
  var Object = heap.entities.Object;
  var Function = heap.entities.Function;

  this.declareCFGStub('allocHashMap', function() {/*
    block AllocHashMap
      base = literal %{baseSize}
      s = loadStubArg %0
      minSize = literal %{minSize}
      size = smiMax s, minSize

      t0 = literal %{fieldShift}
      shift = smiUntag t0
      t1 = smiShl size, shift
      ssize = smiAdd base, t1

      t2 = stub %"allocTagged/hashmap"
      pushArg ssize
      hm = callStub t2, %1

      writeTagged hm, size, %{sizeOff}

      t3 = literal %{fieldOff}
      t4 = smiUntag t3
      start = pointerAdd hm, t4
      t5 = smiUntag ssize
      end = pointerAdd hm, t5

      hole = hole
      pointerFill start, end, hole

      res = cleanupRegs hm
      ret res
  */}, {
    sizeOff: HashMap.offsets.size,
    fieldOff: HashMap.offsets.field,
    baseSize: HashMap.size(0),
    minSize: HashMap.minSize,
    fieldShift: HashMap.shifts.fieldSize
  });

  this.declareCFGStub('allocObject', function() {/*
    block AllocObject
      size = loadStubArg %0

      t0 = stub %"allocHashMap"
      pushArg size
      hashmap = callStub t0, %1

      t1 = stub %"allocTagged/object"
      t2 = literal %{size}
      pushArg t2
      obj = callStub t1, %1

      writeTagged obj, hashmap, %{hmOff}
      ret obj
  */}, {
    hmOff: Object.offsets.hashmap,
    size: Object.size()
  });

  this.declareCFGStub('allocFn', function() {/*
    block AllocFn
      size = literal %0

      t0 = stub %"allocHashMap"
      pushArg size
      hashmap = callStub t0, %1

      t1 = stub %"allocTagged/function"
      t2 = literal %{size}
      pushArg t2
      fn = callStub t1, %1

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
      block AllocTagged -> HasSpace, NeedGC
        t0 = loadStubArg %0
        t1 = smiUntag t0
        size = heap.alignSize t1

        current = heap.current
        limit = heap.limit
        after = pointerAdd current, size
        pointerCompare %"<=", after, limit

      block HasSpace
        heap.setCurrent after
        map = map %{type}
        writeTagged current, map, %{mapOff}

        // Cleanup all registers, except current
        // TODO(indutny): ideally, this should touch only used ones
        res = cleanupRegs current
        ret res

      block NeedGC
        // Allocation not possible at the time
        // TODO(indutny): call runtime
        brk
    */}, {
      type: type,
      mapOff: Base.offsets.map
    });
  }, this);
}

function typeStubs() {
  var Base = heap.entities.Base;

  var types = [
    'boolean',
    'hashmap',
    'object',
    'function'
  ];
  types.forEach(function(type) {
    this.declareCFGStub('checkMap/' + type, function() {/*
      block CheckMap -> Smi, NonSmi
        obj = loadStubArg %0
        isSmi obj

      block NonSmi -> Ok, NotOk
        actual = readTagged obj, %{mapOff}
        expected = map %{type}
        pointerCompare %"==", expected, actual

      block Ok
        ret

      block Smi -> NotOk
      block NotOk
        brk
    */}, {
      type: type,
      mapOff: Base.offsets.map
    });

    this.declareCFGStub('coerce/' + type, function() {/*
      block Coerce -> Smi, NonSmi
        val = loadStubArg %0
        isSmi val

      block Smi -> True, False
        zero = literal %0
        smiCompare %"!=", val, zero

      block True
        r0 = literal %true
        ret r0

      block False
        r1 = literal %false
        ret r1

      block NonSmi -> Same, NotSame
        actual = readTagged val, %{mapOff}
        expected = map %{type}
        pointerCompare %"==", expected, actual

      block Same
        ret val

      block NotSame
        rt = runtime
        rtId = runtimeId %{runtime}
        pushArg val
        pushArg rtId
        r2 = callStub rt, %2
        ret r2
    */}, {
      type: type,
      runtime: 'coerce/' + type,
      mapOff: Base.offsets.map
    });
  }, this);
}

function binaryStubs() {
  var ops = [ '+', '-', '*' ];
  ops.forEach(function(op) {
    this.declareCFGStub('binary/' + op, function() {/*
      block BinaryMath -> LeftSmi, LeftNonSmi
        left = loadStubArg %0
        isSmi left

      block LeftSmi -> RightSmi, RightNonSmi
        right = loadStubArg %1
        isSmi right

      block RightSmi -> Overflow, Success
        // both smis
        #if op === '+'
          r = smiAdd left, right
        #elif op === '-'
          r = smiSub left, right
        #elif op === '*'
          r = smiMul left, right
        #endif
        checkOverflow

      block Success
        ret r

      block LeftNonSmi -> RightNonSmi
      block RightNonSmi -> Overflow
      block Overflow
        // not smis
        brk
    */}, {
      op: op
    });
  }, this);

  var ops = [ '<', '<=' ];
  ops.forEach(function(op) {
    this.declareCFGStub('binary/' + op, function() {/*
      block BinaryLogic -> LeftSmi, LeftNonSmi
        left = loadStubArg %0
        isSmi left

      block LeftSmi -> RightSmi, RightNonSmi
        right = loadStubArg %1
        isSmi right

      block RightSmi -> True, False
        // both smis
        #if op === '<'
          smiCompare %"<", left, right
        #elif op === '<='
          smiCompare %"<=", left, right
        #endif

      block True
        r0 = literal %true
        ret r0

      block False
        r1 = literal %false
        ret r1

      block LeftNonSmi -> RightNonSmi
      block RightNonSmi
        // not smis
        brk
    */}, {
      op: op
    });
  }, this);
}
