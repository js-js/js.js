var js = require('../js');

var esprima = require('esprima');
var ssa = require('ssa.js');
var linearscan = require('linearscan');
var phi = require('phi.js');
var jit = require('jit.js');
var ir = require('ssa-ir');
var util = require('util');

function Compiler(runtime, options) {
  this.runtime = runtime;
  this.heap = this.runtime.heap;
  this.platform = this.runtime.platform;
  this.options = options || {};
  this.linearscan = linearscan.create({
    registers: this.platform.registers,
    instructions: this.platform.instructions
  });
  this.blocks = null;
  this.ctx = null;

  this.stubReferences = [];
}
module.exports = Compiler;

Compiler.prototype.compile = function compile(source) {
  var ast = esprima.parse(source);

  return this.heap.scope(function() {
    var res;

    this.blocks = {};

    // Walk up in the functions tree, first compile used and the compile uses
    ssa.construct(ast).slice().reverse().forEach(function(ssa) {
      ssa = phi.run(ssa);

      this.traceIR('ssa', 'SSA', ssa);

      // Do platform-indepedent optimization
      this.optimize(ssa);

      this.traceIR('opt', 'OPTIMIZED SSA', ssa);

      // Do platform-specific optimization
      this.platform.optimize(ssa);

      this.traceIR('platformOpt', 'PLATFORM OPT SSA', ssa);

      // Allocate registers
      var blocks = this.linearscan.run(ssa);

      this.traceIR('linearscan', 'LINEARSCAN', blocks);

      res = this.generate(blocks, this.linearscan.spillCount());
      this.blocks[ssa[0].id] = res;
    }, this);

    this.blocks = null;

    return res;
  }, this);
};

Compiler.prototype.traceIR = function traceIR(what, desc, ssa) {
  if (!this.options.trace)
    return;

  if (this.options.trace.indexOf(what) === -1 && this.options.trace !== 'all')
    return;

  console.error('----- ' + desc + ' -----');
  console.error(ir.stringify(ssa));
  console.error('----- ' + desc + ' END -----');
};

Compiler.prototype.optimize = function optimize(ssa) {
};

Compiler.prototype.generate = function generate(blocks, spillCount) {
  this.ctx = new Context(this);
  this.platform.ctx = this.ctx;
  var offsets = [];

  var self = this;
  this.platform.doProc(spillCount, function() {
    blocks.forEach(function(block) {
      self.genBlock(block);
    });
  });

  var fn = this.ctx.getFunction();
  this.ctx = null;
  this.platform.ctx = null;
  return fn;
};

Compiler.prototype.genBlock = function genBlock(block) {
  var oldBlock = this.ctx.block;

  this.ctx.masm.bind(this.ctx.blockLabel(block.id));

  for (var i = 0; i < block.instructions.length; i++)
    this.platform.genInstruction(block.instructions[i]);

  this.platform.genGoto(block.successors.map(function(succ) {
    return this.ctx.blockLabel(succ);
  }, this));
};

Compiler.prototype.compileStubs = function compileStubs(body, options) {
  var ctx = new Context(this, options);

  var oldCtx = this.ctx;
  this.ctx = ctx;
  body.call(ctx.masm);
  this.ctx = oldCtx;

  // TODO(indutny): save reference, really
  var code = ctx.getCode();
  this.stubReferences.push(ctx.references);

  return code.code();
};

function Context(compiler, options) {
  this.compiler = compiler;
  this.heap = this.compiler.heap;

  this.block = null;

  this.masm = jit.create(util._extend({
    stubs: this.compiler.platform.stubs,
    helpers: this.compiler.platform.helpers
  }, options || {}));
  this.masm.ctx = this;

  this.references = null;
  this.offsets = [];
  this.blocks = {};
}

Context.prototype.blockLabel = function blockLabel(block) {
  if (!this.blocks[block])
    this.blocks[block] = this.masm.label();

  return this.blocks[block];
};

Context.prototype.getCode = function getCode() {
  var info = this.masm.compile();

  // Note: implicitly using scope in .compile()
  var code = this.heap.allocCode(info.buffer, this.offsets);
  info.resolve(code.code());

  this.references = info.references;

  return code;
};

Context.prototype.getFunction = function getFunction() {
  return this.heap.allocFunction(this.getCode());
};

Context.prototype.addReference = function addReference(offset) {
  this.offsets.push(offset - this.compiler.platform.ptrSize);
};
