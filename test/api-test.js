var assert = require('assert');
var js = require('../');

describe('js.js API', function() {
  var r;
  beforeEach(function() {
    r = js.create();
  });

  it('should compile basic binary expression', function() {
    var fn = r.compile('(1 + 2) + (3 + 4)');
    assert.equal(fn.call([]).cast().value(), 10);
  });
});
