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
  this.declareCFGStub('allocObject', function() {/*
    block AllocObject
      size = loadStubArg %0
      hashmap = allocHashMap size
      obj = allocObject hashmap
      ret obj
  */});

  this.declareCFGStub('allocFn', function() {/*
    block AllocFn
      code = loadStubArg %0
      size = literal %0
      hm1 = allocHashMap size
      fn = allocFn code, hm1

      // prototype
      proto = object %0
      prop = literal %"prototype"
      storeProperty fn, prop, proto

      ret fn
  */});
}

function binaryStubs() {
  var ops = [ '+', '-', '*' ];
  ops.forEach(function(op) {
    this.declareCFGStub('binary/' + op, function() {/*
      block BinaryMath -> B1, B2
        left = loadStubArg %0
        right = loadStubArg %1
        isSmi left

      block B1 -> B3, B4
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
        right = loadStubArg %1
        isSmi left

      block B1 -> B3, B4
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
