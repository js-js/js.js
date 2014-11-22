var assert = require('assert');
var heap = require('heap.js');

function Stub(name, body, config) {
  this.name = name;
  this.body = body;
  this.fn = null;
  this.config = config || {};
  this.ic = this.config.ic || null;
};
exports.Stub = Stub;

Stub.prototype.ptr = function ptr() {
  return this.fn.ptr();
};

exports.extend = function extend(Base) {
  Base.prototype.initStubs = initStubs;
  Base.prototype.declareStub = declareStub;
  Base.prototype.registerStub = registerStub;
  Base.prototype.getStub = getStub;
};

function initStubs() {
  propertyStubs.call(this);
  allocStubs.call(this);
  typeStubs.call(this);
  binaryStubs.call(this);
}

function declareStub(name, body, config) {
  this.cfgStubs[name] = new this.Stub(name, body, config);
};

function registerStub(stub) {
  this.cfgStubs[stub.name] = stub;
};

function getStub(name) {
  var stub = this.cfgStubs[name];
  assert(stub, 'CFG Stub ' + name + ' not found');
  if (stub.fn !== null)
    return stub;

  var body = stub.body;
  var res;
  this.runtime.persistent.wrap(function() {
    res = this.runtime.compiler.compileCFG(body, stub.config);
  }, this);

  stub.fn = res;
  return stub;
};

//
// Stub declarations
//

function propertyStubs() {
  var Object = heap.entities.Object;
  var Field = heap.entities.Field;
  var AttrDict = heap.entities.dict.Attr;

  this.declareStub('getPropertySlot_Miss', function() {/*
    block GetPropertySlot_Miss
      ic = ic
      obj = loadStubArg %0
      prop = loadStubArg %1
      update = loadStubArg %2

      rtId = runtimeId %"getPropertySlot"

      pushArg update
      pushArg prop
      pushArg obj
      pushArg ic
      pushArg rtId

      res = callStub %"stub", %"runtime", %5
      ret res
  */});

  // TODO(indutny): support delete
  var ops = [ 'load', 'store', 'delete' ];
  ops.forEach(function(op) {
    this.declareStub(op + 'PropertySlot', function() {/*
      block OpPropertySlot -> Found, NotFound
        obj = loadStubArg %0
        slot = loadStubArg %1
        #if op === 'store'
          value = loadStubArg %2
        #endif

        isSmi slot

      block Found -> Dense, Attr
        field = readTagged obj, %{field}
        oflags = readTagged field, %{objectFlags}
        dense = literal %{denseFlag}
        smiTest oflags, dense

      block Dense -> Op
        // slot = off + slot
        t8 = literal %{ptrShift}
        t9 = smiShl slot, t8
        t10 = literal %{off}
        t11 = smiAdd t9, t10
        to_phi off, t11

      block Attr -> Op
        // slot = off + slot * {attrDict.itemSize} + {attrDict.value}
        t0 = literal %{attrDict.itemSize}
        t1 = smiMul slot, t0
        t2 = literal %{attrDict.value}
        t3 = smiAdd t1, t2
        t4 = literal %{ptrShift}
        t5 = smiShl t3, t4
        t6 = literal %{off}
        t7 = smiAdd t5, t6
        to_phi off, t7

      block Op
        off = phi
        #if op === 'load'
          res = smiReadTagged field, off
          ret res
        #elif op === 'store'
          smiWriteTagged field, value, off
          res = literal %undefined
          ret res
        #else
          brk
        #endif

      block NotFound
        #if op === 'store'
          // Unreachable
          brk
        #endif

        // Should be undefined
        ret slot
    */}, {
      locals: {
        op: op,
        off: Field.offsets.field,
        field: Object.offsets.field,
        objectFlags: Object.offsets.flags,
        denseFlag: Object.flags.dense,
        ptrShift: heap.ptrShift,

        attrDict: AttrDict.offsets
      }
    });
  }, this);
}

function allocStubs() {
  var Base = heap.entities.Base;
  var Field = heap.entities.Field;
  var Object = heap.entities.Object;
  var Function = heap.entities.Function;
  var Code = heap.entities.Code;
  var AttrDict = heap.entities.dict.Attr;

  this.declareStub('allocField', function() {/*
    block AllocField
      base = literal %{baseSize}
      size = loadStubArg %0

      shift = literal %{fieldShift}
      t1 = smiShl size, shift
      ssize = smiAdd base, t1

      pushArg ssize
      field = callStub %"stub", %"allocTagged/field", %1

      writeTagged field, size, %{sizeOff}

      t3 = literal %{fieldOff}
      t4 = smiUntag t3
      start = pointerAdd field, t4
      t5 = smiUntag ssize
      end = pointerAdd field, t5

      hole = hole
      pointerFill start, end, hole

      ret field
  */}, {
    locals: {
      sizeOff: Field.offsets.size,
      fieldOff: Field.offsets.field,
      baseSize: Field.size(0),
      fieldShift: Field.shifts.field
    }
  });

  this.declareStub('allocHashMap', function() {/*
    block AllocHashMap
      size = literal %{minSize}

      // HashMap needs 3x field
      itemSize = literal %{attrDict.itemSize}
      ssize = smiMul size, itemSize

      pushArg ssize
      res = callStub %"stub", %"allocField", %1

      ret res
  */}, {
    locals: {
      minSize: Object.minSize,
      attrDict: AttrDict.offsets
    }
  });

  this.declareStub('allocObject', function() {/*
    block AllocObject
      hashmap = callStub %"stub", %"allocHashMap", %0

      t2 = literal %{size}
      pushArg t2
      obj = callStub %"stub", %"allocTagged/object", %1

      writeTagged obj, hashmap, %{hmOff}

      flags = literal %0
      writeTagged obj, flags, %{flagOff}
      ret obj
  */}, {
    locals: {
      hmOff: Object.offsets.field,
      flagOff: Object.offsets.flags,
      size: Object.size()
    }
  });

  this.declareStub('allocFn', function() {/*
    block AllocFn
      hashmap = callStub %"stub", %"allocHashMap", %0

      t2 = literal %{size}
      pushArg t2
      fn = callStub %"stub", %"allocTagged/function", %1

      code = loadStubArg %0
      writeTagged fn, hashmap, %{hmOff}
      writeInterior fn, code, %{codeOff}, %{interiorOff}

      // prototype
      proto = object %0
      prop = literal %"prototype"

      // NOTE: storeProperty is replaced with a stub call here
      storeProperty fn, prop, proto

      ret fn
  */}, {
    locals: {
      hmOff: Object.offsets.field,
      codeOff: Function.offsets.code,
      interiorOff: Code.offsets.code,
      size: Function.size()
    }
  });

  var types = [
    'boolean',
    'field',
    'object',
    'function'
  ];
  types.forEach(function(type) {
    this.declareStub('allocTagged/' + type, function() {/*
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

        ret current

      block NeedGC
        // Allocation not possible at the time
        // TODO(indutny): call runtime
        brk
    */}, {
      locals: {
        type: type,
        mapOff: Base.offsets.map
      }
    });
  }, this);
}

function typeStubs() {
  var Base = heap.entities.Base;
  var Map = heap.entities.Map;

  this.declareStub('isFunction', function() {/*
    block IsFunction -> Smi, NonSmi
      obj = loadStubArg %0
      isSmi obj

     block NonSmi -> Ok, NotOk
       map = readTagged obj, %{mapOff}
       actual = readTagged map, %{flagOff}
       expected = literal %{flag}
       smiTest actual, expected

     block Ok
       ret

     block Smi -> NotOk
     block NotOk
       brk
  */}, {
    locals: {
      mapOff: Base.offsets.map,
      flagOff: Map.offsets.flags,
      flag: Map.flags.fn
    }
  });

  var types = [
    'boolean'
  ];
  types.forEach(function(type) {
    this.declareStub('coerce/' + type, function() {/*
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
        rtId = runtimeId %{runtime}
        pushArg val
        pushArg rtId
        r2 = callStub %"stub", %"runtime", %2
        ret r2
    */}, {
      locals: {
        type: type,
        runtime: 'coerce/' + type,
        mapOff: Base.offsets.map
      }
    });
  }, this);
}

function binaryStubs() {
  var ops = [ '+', '-', '*' ];
  ops.forEach(function(op) {
    this.declareStub('binary/' + op, function() {/*
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
      locals: {
        op: op
      }
    });
  }, this);

  var ops = [ '<', '<=' ];
  ops.forEach(function(op) {
    this.declareStub('binary/' + op, function() {/*
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
      locals: {
        op: op
      }
    });
  }, this);
}
