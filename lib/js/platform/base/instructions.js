exports.get = function get() {
  var out = { type: 'register', id: this.ret };
  var reg = { type: 'register' };
  var any = { type: 'any' };
  var js = { type: 'js' };

  return {
    literal: { inputs: [ js ], output: reg },
    ret: { inputs: [ out ], output: null },
    global: { inputs: [], output: reg },
    'this': { inputs: [], output: reg },
    self: { inputs: [], output: reg },
    runtime: { inputs:  [], output: reg, shallow: true },
    brk: { inputs: [], output: null, shallow: true },

    allocHashMap: { inputs: [ reg ], output: out },
    allocObject: { inputs: [ reg ], output: out },
    allocCode: { inputs: [ js ], output: reg },
    allocFn: { inputs: [ reg, reg ], output: out },

    toBoolean: { inputs: [ reg ], output: out, shallow: true },
    nop: { inputs: [ any ], output: [ reg ] },
    loadArg: { inputs: [ js ], output: reg },
    pushArg: { inputs: [ any ], output: null },
    alignStack: { inputs: [ js ], output: null },
    checkMap: { inputs: [ reg, js ], output: null, shallow: true },
    call: {
      inputs: [ reg, reg, js ],
      output: out,
      call: true,
      shallow: true
    },
    stub: { inputs: [ js ], output: reg, shallow: true },
    callStub: {
      inputs: [ reg, js ],
      output: out,
      call: true,
      shallow: true
    },
    loadStubArg: { inputs: [ js ], output: reg },
    alignStubStack: { inputs: [ js ], output: null },
    runtimeId: { inputs: [ js ], output: reg, shallow: true },
    binary: {
      inputs: [ js, reg, reg ],
      output: out,
      shallow: true
    },

    isTrue: { inputs: [ reg ], output: null },
    isSmi: { inputs: [ reg ], output: null, shallow: true },
    checkOverflow: { inputs: [], output: null, shallow: true },
    reverseBranch: { inputs: [], output: null, shallow: true },

    smiAdd: { inputs: [ reg, reg ], output: reg, shallow: true },
    smiSub: { inputs: [ reg, reg ], output: reg, shallow: true },
    smiMul: { inputs: [ reg, reg ], output: out, shallow: true },
    smiCompare: { inputs: [ js, reg, reg ], output: null, shallow: true }
  };
};

exports.getMethods = function getMethods(platform) {
  var res = {};
  Object.keys(platform.instructions).forEach(function(name) {
    res[name] = platform['gen' + name.charAt(0).toUpperCase() + name.slice(1)];
  }, platform);
  return res;
};
