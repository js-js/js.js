exports.get = function get() {
  var out = { type: 'register', id: this.ret };
  var reg = { type: 'register' };
  var any = { type: 'any' };
  var js = { type: 'js' };

  return {
    literal: { inputs: [ js ], output: reg },
    proc: { inputs: [], output: null },
    ret: { inputs: [ out ], output: null },
    icRet: { inputs: [ out ], output: null },
    global: { inputs: [], output: reg },
    'this': { inputs: [], output: reg },
    self: { inputs: [], output: reg },
    brk: { inputs: [], output: null, shallow: true },

    code: { inputs: [ js ], output: reg },
    map: { inputs: [ js ], output: reg },
    hole: { inputs: [ ], output: reg },

    readTagged: { inputs: [ reg, js ], output: reg, shallow: true },
    writeTagged: { inputs: [ reg, reg, js ], output: null, shallow: true },
    writeInterior: {
      inputs: [ reg, reg, js, js ],
      output: null,
      shallow: true
    },

    nop: { inputs: [ any ], output: [ reg ] },
    loadArg: { inputs: [ js ], output: reg },
    pushArg: { inputs: [ any ], output: null, shallow: true },
    repushArgs: { inputs: [ reg, js ], output: null, shallow: true },
    alignStack: { inputs: [ js ], output: null },
    call: {
      inputs: [ reg, reg, js ],
      output: out,
      call: true,
      shallow: true
    },
    callStub: {
      inputs: [ js, js, js ],
      output: out,
      call: true,
      shallow: true
    },
    tailCallStub: {
      inputs: [ js, out ],
      output: null,
      shallow: true
    },
    loadICArg: { inputs: [ js ], output: reg },
    loadStubArg: { inputs: [ js ], output: reg },
    alignStubStack: { inputs: [ js ], output: null },
    runtimeId: { inputs: [ js ], output: reg, shallow: true },
    ic: { inputs: [ ], output: reg, shallow: true },
    unary: {
      inputs: [ js, reg ],
      output: out,
      shallow: true
    },
    binary: {
      inputs: [ js, reg, reg ],
      output: out,
      shallow: true
    },

    isTrue: { inputs: [ reg ], output: null, shallow: true },
    isUndef: { inputs: [ reg ], output: null, shallow: true },
    isSmi: { inputs: [ reg ], output: null, shallow: true },
    checkOverflow: { inputs: [], output: null, shallow: true },
    reverseBranch: { inputs: [], output: null, shallow: true },

    smiNeg: { inputs: [ reg ], output: reg, shallow: true },

    smiUntag: { inputs: [ reg ], output: reg, shallow: true, tainted: true },
    smiAdd: { inputs: [ reg, reg ], output: reg, shallow: true },
    smiSub: { inputs: [ reg, reg ], output: reg, shallow: true },
    smiMul: { inputs: [ reg, reg ], output: out, shallow: true },
    smiCompare: { inputs: [ js, reg, reg ], output: null, shallow: true },
    smiShl: { inputs: [ reg, reg ], output: reg, shallow: true },
    smiMax: { inputs: [ reg, reg ], output: reg, shallow: true },
    smiTest: { inputs: [ reg, reg ], output: null, shallow: true },
    smiReadTagged: { inputs: [ reg, reg ], output: reg, shallow: true },
    smiWriteTagged: { inputs: [ reg, reg, reg ], output: null, shallow: true },
    smiCall: {
      inputs: [ reg, reg, reg ],
      output: out,
      call: true,
      shallow: true
    },

    pointer: { inputs: [ js, js ], output: reg, shallow: true },
    pointerAdd: {
      inputs: [ reg, reg ],
      output: reg,
      shallow: true,
      tainted: true
    },
    pointerCompare: { inputs: [ js, reg, reg ], output: null, shallow: true },
    pointerFill: { inputs: [ reg, reg, reg ], output: null, shallow: true },

    'heap.current': { inputs: [], output: reg, shallow: true, tainted: true },
    'heap.setCurrent': { inputs: [ reg ], output: null, shallow: true },
    'heap.limit': { inputs: [], output: reg, shallow: true, tainted: true },
    'heap.alignSize': {
      inputs: [ reg ],
      output: reg,
      shallow: true,
      tainted: true
    },
  };
};

exports.getMethods = function getMethods(platform) {
  var res = {};
  Object.keys(platform.instructions).forEach(function(name) {
    var method = 'gen' + name.split('.').map(function(part) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join('');
    res[name] = platform[method];
  }, platform);
  return res;
};
