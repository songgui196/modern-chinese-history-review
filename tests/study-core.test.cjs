'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const data = Function(scripts.find(script => script.includes('const COURSE_DATA =')) + '; return COURSE_DATA;')();
const coreModule = { exports: {} };
Function('module', 'exports', scripts.find(script => script.includes('root.StudyCore = factory()')))(coreModule, coreModule.exports);
const core = coreModule.exports;
const at = '2026-11-20T12:00:00.000Z';
const question = (id = 'q1', overrides = {}) => ({
  id, stem: '同一个问题？', type: '单选题', answerStatus: '平台明确公布', answer: ['B'], answerLabel: '乙',
  options: ['甲', '乙', '丙', '丁'].map((text, index) => ({ key: String.fromCharCode(65 + index), text })), ...overrides
});
const stateFor = session => ({ schemaVersion: 1, activeMode: 'practice', sessions: { practice: session, mistakes: null } });
const parseSession = (session, questions) => core.parsePracticeState(JSON.stringify(stateFor(session)), questions).sessions.practice;

test('same stems merge regardless of type, choices, answer or source', () => {
  const first = question();
  const changed = question('q2', { type: '多选题', answer: ['A', 'D'], options: first.options.slice().reverse(), sourceId: 'another-source' });
  const judgment = question('q3', { type: '判断题', options: [{key: 'A', text: '正确'}, {key: 'B', text: '错误'}] });
  const discussion = question('q4', { type: '主题讨论', answer: [], options: [] });
  assert.equal(core.uniquePracticeQuestions([first, changed, judgment, discussion]).length, 1);
  const groups = core.groupQuestions([first, changed, judgment, discussion]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].variants.map(q => q.id), ['q1', 'q2', 'q3', 'q4']);
});

test('formatting differences merge while different stems and decimal values stay distinct', () => {
  const inputs = [question(), question('q2', {stem: ' 同 一 个 问题? '}), question('q3', {stem: '另一个问题？'}),
    question('q4', {stem: '1.5 年'}), question('q5', {stem: '15 年'})];
  assert.equal(core.uniquePracticeQuestions(inputs).length, 4);
  assert.equal(core.uniquePracticeQuestions([question('blank1', {stem: ''}), question('blank2', {stem: ''})]).length, 2);
});

test('a published, gradable representative is preferred without changing source questions', () => {
  const unknown = question('unknown', {answerStatus: '待核实'});
  const published = question('published');
  const snapshot = JSON.stringify([unknown, published]);
  const grouped = core.groupQuestions([unknown, published]);
  assert.equal(grouped[0].id, 'published');
  assert.equal(JSON.stringify([unknown, published]), snapshot);
});

test('the actual bank has one entry per stem and preserves every original source ID', () => {
  const grouped = core.groupQuestions(data.questions);
  assert.equal(new Set(grouped.map(core.questionKey)).size, grouped.length);
  assert.deepEqual(grouped.flatMap(q => q.variants.map(v => v.id)).sort(), data.questions.map(q => q.id).sort());
  assert.equal(grouped.length, 384);
  assert.equal(grouped.filter(q => ['单选题','多选题','判断题'].includes(q.type)).length, 328);
});

test('shuffled display labels and answer feedback correspond to original option identities', () => {
  const q = question();
  const order = core.shuffled(q.options.map(o => o.key), () => 0);
  const options = core.practiceOptions(q, order);
  assert.deepEqual(order, ['B', 'C', 'D', 'A']);
  assert.deepEqual(options.map(o => o.label), ['A', 'B', 'C', 'D']);
  assert.equal(options[0].text, '乙');
  assert.equal(core.gradeAnswer(q, [options[0].key]).correct, true);
  assert.equal(core.gradeAnswer(q, [options[1].key]).correct, false);
  assert.equal(core.answerPresentation(q, options), 'A（乙）');
  assert.equal(core.answerPresentation(q), 'B（乙）');
  assert.deepEqual(q.options.map(o => o.key), ['A', 'B', 'C', 'D']);
});

test('multiple-choice and judgment questions retain correct grading after shuffling', () => {
  const multi = question('multi', {type: '多选题', answer: ['A', 'C']});
  const options = core.practiceOptions(multi, ['D', 'A', 'B', 'C']);
  const selected = options.filter(o => ['B', 'D'].includes(o.label)).map(o => o.key);
  assert.equal(core.gradeAnswer(multi, selected).correct, true);
  assert.equal(core.gradeAnswer(multi, [selected[0]]).correct, false);
  assert.equal(core.answerPresentation(multi, options), 'B（甲）、D（丙）');
  const judgment = question('judgment', {type: '判断题', options: [{key: 'A', text: '正确'}, {key: 'B', text: '错误'}]});
  const judgmentOptions = core.practiceOptions(judgment, ['B', 'A']);
  assert.equal(core.gradeAnswer(judgment, [judgmentOptions[0].key]).correct, true);
  assert.equal(core.answerPresentation(judgment, judgmentOptions), 'A（错误）');
});

test('refresh and exported progress preserve both selected answers and option order in both modes', () => {
  const q = question();
  const practice = core.createPracticeSession([q.id], 'practice', at);
  practice.optionOrders[q.id] = ['D', 'B', 'A', 'C']; practice.selected = ['B'];
  const mistakes = core.createPracticeSession([q.id], 'mistakes', at);
  mistakes.optionOrders[q.id] = ['B', 'A', 'D', 'C']; mistakes.selected = ['A'];
  const state = {schemaVersion: 1, activeMode: 'mistakes', sessions: {practice, mistakes}};
  const loaded = core.parsePracticeState(JSON.stringify(state), [q]);
  assert.deepEqual(loaded, state);
  assert.equal(core.answerPresentation(q, core.practiceOptions(q, loaded.sessions.practice.optionOrders[q.id])), 'B（乙）');
  assert.equal(core.answerPresentation(q, core.practiceOptions(q, loaded.sessions.mistakes.optionOrders[q.id])), 'A（乙）');
});

test('legacy sessions load without option orders and pending repeats are removed', () => {
  const bank = [question('a'), question('duplicate'), question('other', {stem: '另一道题'})];
  const legacy = core.createPracticeSession(bank.map(q => q.id), 'practice', at);
  delete legacy.optionOrders;
  const loaded = parseSession(legacy, bank);
  assert.deepEqual(loaded.ids, ['a', 'other']);
  assert.deepEqual(loaded.optionOrders, {});
  assert.equal(loaded.index, 0);
  assert.equal(loaded.completed, false);
});

test('migration skips a repeated current question while preserving finished statistics', () => {
  const bank = [question('done'), question('duplicate'), question('next', {stem: '下一题'})];
  const session = core.createPracticeSession(bank.map(q => q.id), 'practice', at);
  Object.assign(session, {index: 1, checked: 1, correct: 1, selected: ['A'], optionOrders: {duplicate: ['B','A','C','D']}});
  const loaded = parseSession(session, bank);
  assert.deepEqual(loaded.ids, ['done', 'next']);
  assert.equal(loaded.index, 1);
  assert.equal(loaded.checked, 1);
  assert.equal(loaded.correct, 1);
  assert.deepEqual(loaded.selected, []);
  assert.deepEqual(loaded.optionOrders, {});
  assert.deepEqual(parseSession(loaded, bank), loaded);
});

test('migration safely completes rounds consisting only of remaining duplicates', () => {
  const bank = [question('done'), question('duplicate')];
  const session = core.createPracticeSession(bank.map(q => q.id), 'practice', at);
  Object.assign(session, {index: 1, checked: 1, correct: 1});
  const loaded = parseSession(session, bank);
  assert.deepEqual(loaded.ids, ['done']);
  assert.equal(loaded.completed, true);
  assert.equal(loaded.index, loaded.ids.length);
  assert.deepEqual(parseSession(loaded, bank), loaded);
});

test('submitted feedback and its option order survive migration', () => {
  const bank = [question('current'), question('duplicate'), question('next', {stem: '下一题'})];
  const session = core.createPracticeSession(bank.map(q => q.id), 'practice', at);
  Object.assign(session, {submitted: true, checked: 1, correct: 1, selected: ['B'], optionOrders: {current: ['D','B','C','A']}});
  const loaded = parseSession(session, bank);
  assert.equal(loaded.submitted, true);
  assert.deepEqual(loaded.ids, ['current', 'next']);
  assert.deepEqual(loaded.selected, ['B']);
  assert.deepEqual(loaded.optionOrders.current, ['D','B','C','A']);
});

test('malformed persisted option orders are rejected', () => {
  const q = question();
  for (const order of [['A','A','C','D'], ['A','B'], ['A','B','C','X'], [0,1,2,3]]) {
    const session = core.createPracticeSession([q.id], 'practice', at);
    session.optionOrders[q.id] = order;
    assert.throws(() => parseSession(session, [q]), /顺序/);
  }
  const session = core.createPracticeSession([q.id], 'practice', at);
  session.optionOrders.unknown = ['A','B','C','D'];
  assert.throws(() => parseSession(session, [q]), /顺序/);
});

test('legacy records keep their original IDs while wrong-question counts merge by stem', () => {
  const first = question('first');
  const alias = question('alias', {options: [{key:'A',text:'乙'},{key:'B',text:'甲'},{key:'C',text:'丙'},{key:'D',text:'丁'}], answer:['A']});
  const bank = [first, alias], groups = core.groupQuestions(bank);
  let progress = core.recordAnswer(core.emptyProgress(), alias, ['B'], at);
  progress = core.parseProgress(JSON.stringify(progress), bank);
  assert.deepEqual(core.mistakeIds(progress, groups), ['first']);
  progress = core.recordAnswer(progress, first, ['B'], '2026-11-20T12:01:00.000Z');
  assert.deepEqual(core.mistakeIds(progress, groups), []);
  assert.equal(Object.values(progress.records).reduce((sum, record) => sum + record.attempts, 0), 2);
  assert.deepEqual(Object.keys(progress.records).sort(), ['alias', 'first']);
  assert.deepEqual(core.parseProgress(JSON.stringify(progress), bank), progress);
});

test('all real practice questions retain valid option identities and resumable shuffled orders', () => {
  const pool = core.groupQuestions(data.questions).filter(q => ['单选题','多选题','判断题'].includes(q.type));
  const session = core.createPracticeSession(pool.map(q => q.id), 'practice', at);
  let seed = 196;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const q of pool) {
    const keys = q.options.map(o => String(o.key));
    session.optionOrders[q.id] = core.shuffled(keys, random);
    const shown = core.practiceOptions(q, session.optionOrders[q.id]);
    assert.deepEqual(shown.map(o => o.key).sort(), keys.slice().sort(), q.id);
    const correct = shown.filter(o => q.answer.includes(o.key));
    const result = core.gradeAnswer(q, correct.map(o => o.key));
    if (result.gradable) {
      assert.equal(result.correct, true, q.id);
      const answer = core.answerPresentation(q, shown);
      for (const option of correct) assert.ok(answer.includes(option.label + '（' + option.text + '）'), q.id);
    }
  }
  const loaded = parseSession(session, data.questions);
  assert.deepEqual(loaded, session);
});
