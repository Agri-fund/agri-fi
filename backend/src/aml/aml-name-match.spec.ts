import {
  dateOfBirthAgreement,
  normaliseSanctionsName,
  normaliseTokenSet,
  scoreNameSimilarity,
} from './aml-name-match';

describe('normaliseSanctionsName', () => {
  it('lowercases, strips diacritics and punctuation, and drops noise words', () => {
    expect(normaliseSanctionsName('José  García, LTD.')).toBe('jose garcia');
    expect(normaliseSanctionsName('Acme Holding Group')).toBe('acme');
    expect(normaliseSanctionsName('The Bank of Tehran')).toBe('bank tehran');
  });

  it('keeps digits, which matter for entity names', () => {
    expect(normaliseSanctionsName('Al Noor 7')).toBe('al noor 7');
  });

  it('returns an empty string for blank or non-string input', () => {
    expect(normaliseSanctionsName('')).toBe('');
    expect(normaliseSanctionsName('!!!')).toBe('');
    expect(normaliseSanctionsName(undefined as unknown as string)).toBe('');
  });
});

describe('normaliseTokenSet', () => {
  it('returns ordered unique tokens', () => {
    expect(normaliseTokenSet('Ivan Petrov Ivanov')).toEqual([
      'ivan',
      'petrov',
      'ivanov',
    ]);
  });

  it('de-duplicates repeated tokens', () => {
    expect(normaliseTokenSet('Ali Ali Muhammad')).toEqual(['ali', 'muhammad']);
  });

  it('returns nothing for a name made only of noise words', () => {
    expect(normaliseTokenSet('Limited Inc')).toEqual([]);
  });
});

describe('scoreNameSimilarity', () => {
  it('scores a normalised equality at 100 via the exact method', () => {
    const result = scoreNameSimilarity('Ivan Petrov', { name: 'IVAN PETROV' });
    expect(result).toMatchObject({
      score: 100,
      exactMatch: true,
      method: 'exact',
    });
  });

  it('ignores legal-form suffixes when comparing', () => {
    const result = scoreNameSimilarity('Acme Trading Ltd', {
      name: 'Acme Trading',
    });
    expect(result.score).toBe(100);
    expect(result.method).toBe('exact');
  });

  it('treats full containment as a strong but non-exact hit', () => {
    const result = scoreNameSimilarity('Ivan Petrov', {
      name: 'Ivan Sergeyevich Petrov',
    });
    expect(result.score).toBe(90);
    expect(result.method).toBe('token_overlap');
    expect(result.sharedTokens).toEqual(['ivan', 'petrov']);
  });

  it('scores two shared tokens without containment in the review band', () => {
    const result = scoreNameSimilarity('Ivan Petrov Smirnov', {
      name: 'Ivan Petrovich Smirnov',
    });
    expect(result.score).toBe(70);
    expect(result.method).toBe('token_overlap');
  });

  it('caps a single shared token between short names', () => {
    const result = scoreNameSimilarity('Ivan Petrov', { name: 'Ivan Smirnov' });
    expect(result.score).toBeLessThanOrEqual(65);
    expect(result.method).toBe('partial');
  });

  it('scores unrelated names zero', () => {
    const result = scoreNameSimilarity('Anna Kowalski', {
      name: 'Ivan Petrov',
    });
    expect(result).toEqual({
      score: 0,
      exactMatch: false,
      sharedTokens: [],
      method: 'none',
    });
  });

  it('matches against aliases and skips aliases that normalise away', () => {
    const result = scoreNameSimilarity('Ivan Petrov', {
      name: 'Иван',
      aliases: ['***', 'Ivan Petrov'],
    });
    expect(result.score).toBe(100);
  });

  it('returns none for a subject that normalises to nothing', () => {
    expect(scoreNameSimilarity('Limited', { name: 'Ivan Petrov' })).toEqual({
      score: 0,
      exactMatch: false,
      sharedTokens: [],
      method: 'none',
    });
  });

  it('keeps the best-scoring alias rather than the first', () => {
    const result = scoreNameSimilarity('Mohammed Al-Farsi', {
      name: 'Unrelated Person',
      aliases: ['Muhammad Farsi', 'Mohammed Al Farsi'],
    });
    expect(result.score).toBe(100);
    expect(result.exactMatch).toBe(true);
  });
});

describe('dateOfBirthAgreement', () => {
  it('gives the full bonus for an exact match', () => {
    expect(dateOfBirthAgreement('1960-04-02', '1960-04-02')).toBe(8);
  });

  it('grades a partial year match lower than an exact one', () => {
    expect(dateOfBirthAgreement('1960', '1960-04-02')).toBe(4);
    expect(dateOfBirthAgreement('1960-04-02', '1960')).toBe(4);
  });

  it('gives nothing for a different year or a missing date', () => {
    expect(dateOfBirthAgreement('1961', '1960-04-02')).toBe(0);
    expect(dateOfBirthAgreement('1960', null)).toBe(0);
    expect(dateOfBirthAgreement(undefined, '1960')).toBe(0);
  });

  it('trims surrounding whitespace before comparing', () => {
    expect(dateOfBirthAgreement(' 1960-04-02 ', '1960-04-02')).toBe(8);
  });
});
