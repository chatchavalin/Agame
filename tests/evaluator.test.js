/**
 * tests/evaluator.test.js — A-Math equation validity rules.
 * Runs the real window.AMath.evaluator.validateEquation against the rule set.
 */
'use strict';
const { load, T, summary } = require('./harness');
const AMath = load();
const ok = (faces) => { const v = AMath.evaluator.validateEquation(faces); return !!(v && v.valid); };

console.log('evaluator.test.js');

// Basic arithmetic
T('simple add valid', ok(['2', '+', '3', '=', '5']));
T('wrong sum invalid', !ok(['2', '+', '3', '=', '6']));
T('subtraction', ok(['9', '-', '4', '=', '5']));
T('multiplication', ok(['3', '×', '4', '=', '1', '2']));
T('division', ok(['8', '÷', '2', '=', '4']));
T('division by zero invalid', !ok(['5', '÷', '0', '=', '5']));

// Multi-equation lines (all sides must be equal)
T('multi-equals all equal', ok(['1', '+', '1', '=', '2', '=', '1', '+', '1']));
T('multi-equals unequal invalid', !ok(['1', '+', '1', '=', '2', '=', '3']));

// Digit concatenation
T('adjacent digits concat', ok(['1', '2', '+', '3', '=', '1', '5']));
T('leading zero forbidden', !ok(['0', '5', '+', '1', '=', '6']));
T('standalone zero ok', ok(['0', '+', '5', '=', '5']));

// Operator precedence
T('mul before add', ok(['2', '+', '3', '×', '4', '=', '1', '4']));

// Unary sign rules
T('unary minus at start', ok(['-', '3', '+', '5', '=', '2']));
T('unary minus after equals', ok(['8', '=', '-', '2', '+', '1', '0']));
T('unary plus forbidden', !ok(['+', '3', '=', '3']));
T('two adjacent operators forbidden', !ok(['2', '+', '+', '3', '=', '5']));

// Structural rules
T('cannot end with operator', !ok(['2', '+', '3', '=']));
T('single number not an equation', !ok(['5']));
T('lone equals invalid', !ok(['=']));

// Number length (A-Math: up to 3 digits)
T('three-digit number ok', ok(['1', '0', '0', '=', '1', '0', '0']));
T('four-digit number forbidden', !ok(['1', '0', '0', '0', '=', '1', '0', '0', '0']));

// Fractions
T('fraction equality', ok(['1', '÷', '2', '=', '2', '÷', '4']));

process.exit(summary());
