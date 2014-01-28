var assert = require('assert');
var mmap = require('mmap');
var ref = require('ref');
var weak = require('weak');

function Page(buf) {
  this.buf = buf;
  this.end = buf.slice(buf.length);
  this.offset = 0;
  this.length = buf.length;
}

Page.prototype.unmap = function unmap() {
  if (this.buf !== null) {
    this.buf.unmap();
    this.buf = null;
    this.end = null;
  }
};

function Space(options) {
  if (!options)
    options = {};

  this.executable = options.executable || false;
  this.pageSize = options.pageSize || 1024 * 1024;
  assert.equal(this.pageSize % mmap.PAGESIZE, 0);

  // Amount of free space that should be available in page after allocation
  this.pageCap = options.pageCap || 1024;

  this.pages = [];

  // Data, available for immediate allocation
  // NOTE: That `pageStart` and `pageEnd` are exposed to the generated
  // code.
  this.page = null;
  this.pageStart = ref.alloc('pointer', ref.NULL);
  this.pageEnd = ref.alloc('pointer', ref.NULL);

  // Add initial page
  this.update(this.addPage());
}

Space.prototype.update = function update(page) {
  ref.set(this.pageStart, 0, page.buf.slice(page.offset));
  if (this.page !== page) {
    this.page = page;
    ref.set(this.pageEnd, 0, page.end);
  }
};

Space.prototype.addPage = function addPage(size) {
  var size = size || this.pageSize;
  if (size % mmap.PAGESIZE !== 0)
    size += mmap.PAGESIZE - size % mmap.PAGESIZE;

  var prot = mmap.PROT_READ | mmap.PROT_WRITE;
  if (this.executable)
    prot |= mmap.PROT_EXEC;

  var flags = mmap.MAP_PRIVATE | mmap.MAP_ANON;
  var buf = mmap(size, prot, flags, -1, 0);

  var page = new Page(buf);
  weak(page, function() {
    page.unmap();
  });

  this.pages.push(page);

  return page;
};

Space.prototype.allocate = function allocate(num) {
  // Current page doesn't have that much space
  if (this.page.offset + num > this.page.length) {
    var page;

    // Check if we have any pages that could fit it
    for (var i = 0; i < this.pages.length; i++) {
      page = this.pages[i];
      if (page.offset + num > page.length)
        continue;

      this.page = page;
      break;
    }

    // Allocate new page
    if (i === this.pages.length) {
      page = this.addPage(num + this.pageCap);
      this.page = page;
    }
  }

  var res = this.page.buf.slice(this.page.offset, this.page.offset + num);
  this.page.offset += num;

  // Align buffer
  if (this.page.offset & 7 !== 0)
    this.page.offset += 8 - (this.page.offset & 7);

  this.update(this.page);
  return res;
};

function Heap(options) {
  if (!options)
    options = {};

  // TODO(indutny): ASLR
  this.spaces = {
    code: new Space({ executable: true }),
    data: {
      old: new Space(),
      young: new Space()
    },
    map: new Space({ pageSize: 256 * 1024 })
  };

  this.mapSize = options.mapSize || 256;
  this.valueOffset = ref.sizeof.pointer;
  this.maps = {};

  this.initializeMaps();
}
exports.Heap = Heap;

Heap.prototype.initializeMaps = function initializeMaps() {
  // Do not store direct maps here, they could move
  this.maps.context = this.allocateMap(null, 0).ref();
  this.maps.code = this.allocateMap(null, 0).ref();

  this.maps.object = this.allocateMap(null).ref();
  this.maps.fn = this.allocateMap(this.maps.object).ref();
  this.maps.number = this.allocateMap(this.maps.object).ref();
  this.maps.string = this.allocateMap(this.maps.object).ref();
  this.maps.cons = this.allocateMap(this.maps.object).ref();
  this.maps.dense = this.allocateMap(this.maps.dense).ref();
};

Heap.prototype.allocate = function allocate(map, size, space) {
  if (!map)
    map = ref.NULL_POINTER;
  if (!space)
    space = this.spaces.data.young;

  var raw = space.allocate(map.length + size);
  ref.set(raw, 0, map.deref(), 'pointer');

  return raw;
};

Heap.prototype.allocateMap = function allocateMap(parent, size) {
  if (!size)
    size = this.mapSize;

  var map = this.allocate(parent, size, this.spaces.map);
  map.fill(0, this.valueOffset);

  return map;
};

Heap.prototype.allocateNumber = function allocateNumber(value, space) {
  var num = this.allocate(this.maps.number, ref.sizeof.double, space);
  ref.set(num, this.valueOffset, value, 'double');
  return num;
};

Heap.prototype.allocateCode = function allocateCode(clen, tlen, rlen) {
  var size = clen;
  if (size % ref.sizeof.pointer !== 0)
    size += ref.sizeof.pointer - (size % ref.sizeof.pointer);
  size += ref.sizeof.pointer * (tlen + rlen);

  var code = this.allocate(this.maps.code, size, this.spaces.code);
  return code;
};

Heap.prototype.allocateContext = function allocateContext(parent, size, space) {
  var ctx = this.allocate(this.maps.context,
                          ref.sizeof.pointer * (size + 2),
                          space);
  ref.set(ctx, this.valueOffset, parent || ref.NULL, 'pointer');
  ref.set(ctx, this.valueOffset + ref.sizeof.pointer, size, 'size_t');

  return ctx;
};

Heap.prototype.allocateFn = function allocateF(context, code, space) {
  var fn = this.allocate(this.maps.fn,
                         ref.sizeof.pointer * 2,
                         space);
  ref.set(fn, this.valueOffset, context, 'pointer');
  ref.set(fn, this.valueOffset + ref.sizeof.pointer, code, 'pointer');
  return fn;
};

Heap.prototype.collectGarbage = function collectGarbage(stack) {
  // TODO(indutny): Implement me
};
