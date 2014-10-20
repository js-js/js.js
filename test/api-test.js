var assert = require('assert');
var js = require('../');

describe('js.js API', function() {
  var r;
  beforeEach(function() {
    r = js.create();
  });

  it('should compile code', function() {
    var fn = r.compile('1 + 1');
    assert.equal(fn.call([]), 2);
  });
});
