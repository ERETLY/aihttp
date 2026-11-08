'use strict';

const pkg = require('../package.json');

const DEFAULT_UA = 'Mozilla/5.0 (compatible; aihttp/' + pkg.version + '; +https://github.com/ERETLY/aiweb)';

module.exports = { DEFAULT_UA };
