exports.init = function init() {
  this.declareCFGStub('storeProperty', function() {/*
    block B1
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
    block B1
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
    block B1
      i1 = literal %undefined
      ret i1
  */});

  this.declareCFGStub('allocObject', function() {/*
    block B1
      size = loadStubArg %0
      hashmap = allocHashMap size
      obj = allocObject hashmap
      ret obj
  */});

  this.declareCFGStub('allocFn', function() {/*
    block B1
      code = loadStubArg %0
      size = literal %0
      hm1 = allocHashMap size
      fn = allocFn code, hm1

      # prototype
      proto = object %0
      prop = literal %"prototype"
      storeProperty fn, prop, proto

      ret fn
  */});
};
