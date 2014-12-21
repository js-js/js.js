var js = require('../../../js');
var stub = js.platform.base.stub;
var ic = js.platform.base.ic;

var assert = require('assert');
var jit = require('jit.js');
var cfgjs = require('cfg.js');
var heap = require('heap.js');
var ir = require('cfg-ir');
var util = require('util');

function BaseState(parent) {
  this.parent = parent;

  this.id = 0;
  this.argsWaiting = 0;
  this.argsTotal = 0;
  this.pendingCall = null;
  this.pendingFn = null;

  this.block = null;
  this.instr = null;
}

BaseState.prototype.clone = function clone() {
  var child = new BaseState(this);

  child.id = this.id;
  child.block = this.block;
  child.instr = this.instr;

  return child;
};

BaseState.prototype.retire = function retire() {
  this.parent.block = this.block;
  this.parent.instr = this.instr;
  this.parent.id = this.id;
  return this.parent;
};

BaseState.prototype.getId = function getId() {
  return 'js.js/' + this.id++;
};

BaseState.prototype.createJS = function createJS(value) {
  return this.block.createValue('js', null, value);
};

function Base(runtime) {
  this.runtime = runtime;
  this.ctx = null;

  this._baseState = new BaseState();

  // NOTE: will be set by runtime
  this.heap = null;
  this.compiler = null;

  this.helpers = util._extend({}, Base.helpers);
  this.helpers.platform = this;

  this.ptrSize = 0;

  this.Stub = stub.Stub;
  this.IC = ic.IC;

  // Get helpers, args, ret
  this.init();

  this.registers = null;
  this.instructions = Base.instructions.get.call(this);
  this.instructionMethods = null;

  var self = this;
  this.stubs = jit.stubs({
    helpers: this.helpers,
    compile: function(body, options) {
      return self.ctx.compiler.compileStubs(body, options);
    }
  });

  this.cfgStubs = {};

  this.initStubs();
}
stub.extend(Base);
ic.extend(Base);
module.exports = Base;

Base.helpers = js.platform.base.helpers;
Base.instructions = js.platform.base.instructions;

Base.prototype.masm = function masm() {
  return this.ctx.masm;
};

Base.prototype.instr = function instr(type, inputs) {
  var state = this._baseState;

  var res = state.block.createValue('instruction', type, state.getId());
  if (inputs) {
    inputs.forEach(function(input) {
      res.addInput(input);
    });
  }
  return res;
};

Base.prototype.spliceCFG = function spliceCFG(block, fn) {
  this._baseState.block = block;
  for (var i = block.instructions.length - 1; i >= 0; i--) {
    var instr = block.instructions[i];

    this._baseState.instr = instr;

    var res = fn.call(this, instr);
    this._baseState.instr = null;
    if (!res)
      continue;

    block.instructions.splice.apply(block.instructions,
                                    [ i , 1 ].concat(res.list));
    if (instr !== res.replace)
      instr.replaceWith(res.replace);
  }
  this._baseState.block = null;
}

Base.prototype.optimize = function optimize(ssa) {
  ssa.forEach(function(block) {
    // Replace loadGlobal/storeGlobal with
    // loadProperty/storeProperty + global
    this.spliceCFG(block, this.replaceGlobal);

    // fn = stub allocFn
    this.spliceCFG(block, this.replaceFn);

    // object = stub allocObject
    this.spliceCFG(block, this.replaceObject);

    // Replace store property/load property with a stub call
    this.spliceCFG(block, this.replaceProp);

    // unary = stub unary
    this.spliceCFG(block, this.replaceUnary);

    // binary = stub binary
    this.spliceCFG(block, this.replaceBinary);

    // new = stub new
    this.spliceCFG(block, this.replaceNew);

    // branch = toBoolean + isTrue
    this.spliceCFG(block, this.replaceBranch);

    // first pushArg = checkFunction + alignStack %num + pushArg
    this.spliceCFG(block, this.replacePushArg);
  }, this);
};

Base.prototype.replaceGlobal = function replaceGlobal(instr) {
  var type;
  if (instr.type === 'loadGlobal')
    type = 'loadProperty';
  else if (instr.type === 'storeGlobal')
    type = 'storeProperty';
  else if (instr.type === 'deleteGlobal')
    type = 'deleteProperty';
  else
    return false;

  var literal = this.instr('literal', [ instr.removeInput(0) ]);

  var global = this.instr('global');
  var op = this.instr(type, [
    global,
    literal
  ].concat(instr.removeAllInputs()));

  return {
    list: [ global, literal, op ],
    replace: op
  };
};

Base.prototype.replaceObject = function replaceObject(instr) {
  if (instr.type !== 'object')
    return;

  var state = this._baseState;
  var Object = heap.entities.Object;

  instr.removeAllInputs();

  var call = this.instr('callStub', [
    state.createJS('stub'),
    state.createJS('allocObject'),
    state.createJS(0)
  ]);
  return {
    list: [ call ],
    replace: call
  };
};

Base.prototype.replaceFn = function replaceFn(instr) {
  if (instr.type !== 'fn')
    return;

  var state = this._baseState;

  var code = this.instr('code', instr.removeAllInputs());
  var arg = this.instr('pushArg', [ code ]);
  var call = this.instr('callStub', [
    state.createJS('stub'),
    state.createJS('allocFn'),
    state.createJS(1)
  ]);
  return {
    list: [ code, arg, call ],
    replace: call
  };
};

Base.prototype.replaceUnary = function replaceUnary(instr) {
  if (instr.type !== 'unary')
    return;

  var state = this._baseState;
  var inputs = instr.removeAllInputs();

  var op = inputs[0].id;
  var src = this.instr('pushArg', [ inputs[1] ]);
  var call = this.instr('callStub', [
    state.createJS('stub'),
    state.createJS('unary/' + op),
    state.createJS(1)
  ]);

  return {
    list: [ src, call ],
    replace: call
  };
};

Base.prototype.replaceNew = function replaceNew(instr) {
  if (instr.type !== 'new')
    return;

  var state = this._baseState;
  var inputs = instr.removeAllInputs();

  var fn = inputs[0];
  var argc = inputs[1];

  var vargc = this.instr('literal', [ argc ]);

  var args = [
    this.instr('pushArg', [ fn ]),
    this.instr('pushArg', [ vargc ])
  ];
  var call = this.instr('callStub', [
    state.createJS('stub'),
    state.createJS('new'),
    state.createJS(args.length + argc.id)
  ]);

  var res = args.concat(call);
  res = [ vargc ].concat(res);

  return {
    list: res,
    replace: call
  };
};

Base.prototype.replaceBinary = function replaceBinary(instr) {
  if (instr.type !== 'binary')
    return;

  var state = this._baseState;
  var inputs = instr.removeAllInputs();

  var op = inputs[0].id;
  var left = this.instr('pushArg', [ inputs[2] ]);
  var right = this.instr('pushArg', [ inputs[1] ]);
  var call = this.instr('callStub', [
    state.createJS('stub'),
    state.createJS('binary/' + op),
    state.createJS(2)
  ]);

  return {
    list: [ left, right, call ],
    replace: call
  };
};

Base.prototype.replaceBranch = function replaceBranch(instr) {
  if (instr.type !== 'branch')
    return;

  var state = this._baseState;
  var arg = this.instr('pushArg', instr.removeAllInputs());
  var call = this.instr('callStub', [
    state.createJS('stub'),
    state.createJS('coerce/boolean'),
    state.createJS(1)
  ]);

  var isTrue = this.instr('isTrue', [ call ]);

  return {
    list: [ arg, call, isTrue ],
    replace: isTrue
  };
};

Base.prototype.replacePushArg = function replacePushArg(instr) {
  if (instr.type !== 'pushArg' &&
      instr.type !== 'call' &&
      instr.type !== 'callStub') {
    return;
  }

  // Find number of args
  var state = this._baseState;

  // Clone base state to preserve call stack
  if (instr.type !== 'pushArg') {
    state = state.clone();
    this._baseState = state;
  }

  if (instr.type === 'call') {
    state.argsWaiting = instr.inputs[2].id;
    state.argsTotal = instr.inputs[2];
    state.pendingFn = instr.inputs[0];
    state.pendingCall = instr;
    if (state.argsWaiting !== 0)
      return;
  } else if (instr.type === 'callStub') {
    state.argsWaiting = instr.inputs[2].id;
    state.argsTotal = instr.inputs[2];
    state.pendingFn = instr.inputs[0];
    state.pendingCall = instr;
    if (state.argsWaiting !== 0)
      return;
  }

  // Not the first push
  if (instr.type === 'pushArg' && --state.argsWaiting !== 0)
    return;

  var out = [];

  var align;
  if (state.pendingCall.type === 'call') {
    // CheckFunction call
    out.push(this.instr('alignStubStack', [ state.createJS(1) ]));
    out.push(this.instr('pushArg', [ state.pendingFn ]));
    var call = this.instr('callStub', [
      state.createJS('stub'),
      state.createJS('checkFunction'),
      state.createJS(1)
    ]);
    out.push(call);

    align = this.instr('alignStack', [ state.argsTotal ]);
  } else {
    align = this.instr('alignStubStack', [ state.argsTotal ]);
  }
  out.push(align, instr);
  this._baseState = state.retire();

  return {
    list: out,
    replace: instr
  };
};

Base.prototype.replaceProp = function replaceProp(instr) {
  if (instr.type !== 'loadProperty' &&
      instr.type !== 'storeProperty' &&
      instr.type !== 'deleteProperty') {
    return false;
  }

  var state = this._baseState;
  var list = [];

  var inputs = instr.removeAllInputs();
  var obj = inputs[0];
  var prop = inputs[1];
  var value = inputs[2];

  var update = this.instr('literal', [
    state.createJS(instr.type === 'storeProperty' ? 1 : 0)
  ]);
  list.push(update);

  var args = [];
  args.push(this.instr('pushArg', [ update ]));
  args.push(this.instr('pushArg', [ prop ]));
  args.push(this.instr('pushArg', [ obj ]));
  list = list.concat(args);

  var slot = this.instr('callStub', [
    state.createJS('ic'),
    state.createJS(prop.type === 'literal' ? 'getFixedPropertySlot' :
                                             'getPropertySlot'),
    state.createJS(args.length)
  ]);
  list.push(slot);

  var res;
  if (instr.type === 'storeProperty') {
    var args = [];
    args.push(this.instr('pushArg', [ value ]));
    args.push(this.instr('pushArg', [ slot ]));
    args.push(this.instr('pushArg', [ prop ]));
    args.push(this.instr('pushArg', [ obj ]));
    list = list.concat(args);

    res = this.instr('callStub', [
      state.createJS('stub'),
      state.createJS('storePropertySlot'),
      state.createJS(args.length)
    ]);
    list.push(res);
  } else {
    var args = [];
    args.push(this.instr('pushArg', [ slot ]));
    if (instr.type === 'loadProperty')
      args.push(this.instr('pushArg', [ prop ]));
    args.push(this.instr('pushArg', [ obj ]));
    list = list.concat(args);

    res = this.instr('callStub', [
      state.createJS('stub'),
      state.createJS(instr.type === 'loadProperty' ? 'loadPropertySlot' :
                                                     'deletePropertySlot'),
      state.createJS(args.length)
    ]);
    list.push(res);
  }

  return {
    list: list,
    replace: res
  };
};

Base.prototype.genInstruction = function genInstruction(instr) {
  instr.masmOffset = this.masm().getOffset();
  if (instr.type === 'gap')
    return this.genGap(instr);

  if (this.instructionMethods === null)
    this.instructionMethods = Base.instructions.getMethods(this);

  var method = this.instructionMethods[instr.type];
  if (!method)
    throw new Error('Unknown instruction type: ' + instr.type);

  return method.call(this, instr);
};

Base.prototype.genIC = function genIC(stub) {
  var ic = new this.IC(this, stub);
  ic.generate();
  return ic;
};
