exports.init = function init() {
  this.declareCFGStub('storeProperty', function() {/*
    block B1
      obj = loadArg %0
      prop = loadArg %1
      value = loadArg %2
      rtId = runtimeId %"storeProperty"
      rt = runtime

      pushArg value
      pushArg prop
      pushArg obj
      pushArg rtId

      g = global
      res = call rt, g, %4
      ret res
  */});

  this.declareCFGStub('loadProperty', function() {/*
    block B1
      obj = loadArg %0
      prop = loadArg %1
      rtId = runtimeId %"loadProperty"
      rt = runtime

      pushArg prop
      pushArg obj
      pushArg rtId

      g = global
      res = call rt, g, %3
      ret res
  */});

  this.declareCFGStub('deleteProperty', function() {/*
    block B1
      i1 = literal %undefined
      ret i1
  */});
};
