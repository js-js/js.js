var js = require('../js');

var assert = require('assert');
var esprima = require('esprima');
var cfgjs = require('cfg.js');
var ssa = require('ssa.js');
var linearscan = require('linearscan');
var jit = require('jit.js');
var ir = require('cfg-ir');
var disasm = require('disasm');
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
    cfgjs.construct(ast).slice().reverse().forEach(function(cfg) {
      res = this.compileCFG(cfg);
      this.blocks[cfg[0].id] = {
        cfg: cfg,
        fn: res
      };
    }, this);

    this.blocks = null;

    return res;
  }, this);
};

Compiler.prototype.compileCFG = function compileCFG(cfg, options) {
  options = options || {};

  if (typeof cfg === 'function') {
    cfg = cfg.toString().replace(/^function[^{]*{\/\*|\*\/}$/g, '');
    cfg = ir.parse(cfg, options.locals || {});
  }
  cfg = new cfgjs.Graph(ssa.run(cfg)).construct();

  this.traceIR('ssa', 'SSA', cfg);

  // Do platform-indepedent optimization
  this.optimize(cfg);

  this.traceIR('opt', 'OPTIMIZED SSA', cfg);

  // Do platform-specific optimization
  this.platform.compiler = this;
  this.platform.optimize(cfg);

  this.traceIR('platformOpt', 'PLATFORM OPT SSA', cfg);

  // Allocate registers
  var blocks = this.linearscan.run(cfgjs.Graph.strip(cfg));

  // Add `proc` to non-ICs
  if (options.type !== 'ic') {
    blocks[0].instructions.unshift({
      id: null,
      type: 'proc',
      inputs: []
    });
  }

  this.traceIR('linearscan', 'LINEARSCAN', blocks);

  var out = this.generate(blocks, this.linearscan.spillCount(), options);
  this.traceAsm(blocks, out);
  return out;
};

Compiler.prototype.isTracing = function isTracing(what) {
  if (!this.options.trace)
    return false;

  if (this.options.trace.indexOf(what) === -1 && this.options.trace !== 'all')
    return false;

  return true;
};

Compiler.prototype.traceIR = function traceIR(what, desc, ssa) {
  if (!this.isTracing(what))
    return;

  console.error('----- ' + desc + ' -----');
  var cfg = ssa;
  if (what !== 'linearscan')
    cfg = cfgjs.Graph.strip(cfg);

  console.error(ir.stringify(cfg));
  console.error(ir.dotify(cfg));
  console.error('----- ' + desc + ' END -----');
};

Compiler.prototype.traceAsm = function traceAsm(blocks, fn) {
  if (!this.isTracing('asm'))
    return;

  var asm = disasm.create({ swallow: true }).disasm(fn.code().code());

  // Clone blocks
  blocks = blocks.map(function(block) {
    return {
      id: block.id,
      successors: block.successors,
      instructions: block.instructions.slice()
    };
  });

  var last = asm.length - 1;
  for (var i = blocks.length - 1; i >= 0; i--) {
    var block = blocks[i];
    for (var j = block.instructions.length - 1; j >= 0; j--) {
      var instr = block.instructions[j];
      for (; last >= 0 && asm[last].offset >= instr.masmOffset; last--) {
        block.instructions.splice(j + 1, 0, {
          id: null,
          type: '; ' + disasm.stringifyInstr(asm[last]),
          inputs: []
        });
      }
    }
  }
  console.error('----- ASM -----');
  console.error(ir.stringify(blocks));
  console.error('----- ASM END -----');
};

Compiler.prototype.optimize = function optimize(ssa) {
};

Compiler.prototype.masmCtx = function masmCtx(body, options, self) {
  var oldCtx = this.ctx;
  assert(this.ctx === this.platform.ctx);

  this.ctx = new Context(this, options);
  this.platform.ctx = this.ctx;

  var res = body.call(self, this.ctx);

  this.ctx = oldCtx;
  this.platform.ctx = oldCtx;

  return res;
};

Compiler.prototype.generate = function generate(blocks, spillCount, options) {
  var self = this;

  return this.masmCtx(function() {
    this.ctx.spillCount = spillCount;

    body();

    function body() {
      if (self.options.brk)
        self.ctx.masm.int3();
      for (var i = 0; i < blocks.length; i++)
        self.genBlock(blocks[i], blocks[i + 1]);
    }

    return this.ctx.getFunction();
  }, options, this);
};

Compiler.prototype.genBlock = function genBlock(block, next) {
  var oldBlock = this.ctx.block;

  this.ctx.masm.bind(this.ctx.blockLabel(block.id));

  for (var i = 0; i < block.instructions.length; i++)
    this.platform.genInstruction(block.instructions[i]);

  var nextLabel;
  if (next)
    nextLabel = this.ctx.blockLabel(next.id);

  var succLabels = block.successors.map(function(succ) {
    return this.ctx.blockLabel(succ);
  }, this)

  this.platform.genGoto(succLabels, nextLabel);
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
  this.options = options || {};

  this.block = null;
  this.spillCount = null;

  this.masm = jit.create(util._extend({
    stubs: this.compiler.platform.stubs,
    helpers: this.compiler.platform.helpers
  }, options || {}));
  this.masm.ctx = this;

  this.references = null;
  this.offsets = [];
  this.weakOffsets = [];
  this.blocks = {};
}

Context.prototype.blockLabel = function blockLabel(block) {
  if (!this.blocks[block])
    this.blocks[block] = this.masm.label();

  return this.blocks[block];
};

Context.prototype.getCode = function getCode() {
  var info = this.masm.compile();

  // XXX(indutny): prevent GC from happening here, as `info` contains
  // not yet referenced heap pointers
  //
  // Note: implicitly using scope in .compile()
  var code = this.heap.allocCode(info.buffer, this.offsets, this.weakOffsets);
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

Context.prototype.addWeakReference = function addWeakReference(offset) {
  this.weakOffsets.push(offset - this.compiler.platform.ptrSize);
};
