import { csvDate, decimal, readCashCsv, writeCashCsv } from './cash-ledger-csv';

describe('Cash CSV format', () => {
  it('accepts a hand-written Italian file without metadata or technical identifiers', () => {
    const rows = readCashCsv(
      'Data;Operazione;Importo;Commissione;Valuta;Nota\n2026-10-01;Deposito;100.01;0;EUR;bonifico'
    );
    expect(rows[0]).toMatchObject({
      Date: '2026-10-01',
      Operation: 'DEPOSIT',
      Amount: '100.01',
      Record: 'EVENT'
    });
  });
  it('preserves decimal precision and leading zero references', () => {
    const rows = readCashCsv(
      'Date,Operation,Amount,Currency,Reference\n2026-10-01,DEPOSIT,0.12345678901234567890123456789,EUR,00001'
    );
    expect(rows[0].Reference).toBe('00001');
    expect(decimal(rows[0].Amount)).toBe('0.12345678901234567890123456789');
  });
  it.each([
    '=SUM(A1:A2)',
    '+cmd',
    '-text',
    '@text',
    "'literal",
    "''literal",
    'nota, con virgola\ne nuova riga'
  ])('round-trips protected text %s', (Note) => {
    const csv = writeCashCsv([
      {
        Date: '2026-10-01',
        Operation: 'DEPOSIT',
        Amount: '10',
        Currency: 'EUR',
        Note
      }
    ]);
    expect(readCashCsv(csv)[0].Note).toBe(Note);
  });
  it('rejects unknown versions and columns', () => {
    expect(() =>
      readCashCsv(
        'Version,Date,Operation,Amount,Currency\n3,2026-10-01,DEPOSIT,10,EUR'
      )
    ).toThrow();
    expect(() =>
      readCashCsv(
        'Date,Operation,Amount,Currency,Unknown\n2026-10-01,DEPOSIT,10,EUR,x'
      )
    ).toThrow();
  });
  it.each(['EXTERNAL_CAPITAL', 'INCOME', 'EXPENSE', ''])(
    'round-trips CSV v2 category %s exactly',
    (EconomicClassification) => {
      const csv = writeCashCsv([
        {
          Version: '2',
          Date: '2026-10-01',
          Operation: 'DEPOSIT',
          Amount: '100',
          Currency: 'EUR',
          EconomicClassification
        }
      ]);
      expect(readCashCsv(csv)[0]).toMatchObject({
        Version: '2',
        EconomicClassification
      });
    }
  );
  it.each(['income', ' INCOME', 'INCOME ', 'null', 'UNKNOWN', '0'])(
    'rejects malformed category %s',
    (EconomicClassification) => {
      expect(() =>
        readCashCsv(
          writeCashCsv([
            {
              Version: '2',
              Date: '2026-10-01',
              Operation: 'DEPOSIT',
              Amount: '100',
              Currency: 'EUR',
              EconomicClassification
            }
          ])
        )
      ).toThrow();
    }
  );
  it.each(['ACTIVITY', 'TRANSFER', 'RECONCILIATION'])(
    'rejects manual category on %s',
    (Operation) => {
      expect(() =>
        readCashCsv(
          writeCashCsv([
            {
              Version: '2',
              Date: '2026-10-01',
              Operation,
              Amount: '100',
              Currency: 'EUR',
              EconomicClassification: 'INCOME'
            }
          ])
        )
      ).toThrow();
    }
  );
  it('rejects categories on metadata and forged linked manual rows', () => {
    for (const extra of [
      { Record: 'META' },
      { ActivityId: 'order' },
      { TransferReference: 'transfer' }
    ]) {
      expect(() =>
        readCashCsv(
          writeCashCsv([
            {
              Version: '2',
              Date: '2026-10-01',
              Operation: 'DEPOSIT',
              Amount: '100',
              Currency: 'EUR',
              EconomicClassification: 'INCOME',
              ...extra
            }
          ])
        )
      ).toThrow();
    }
  });
  it.each(['1', ''])(
    'refuses classified data without an explicit v2 contract (version %s)',
    (Version) => {
      expect(() =>
        readCashCsv(
          writeCashCsv([
            {
              Version,
              Date: '2026-10-01',
              Operation: 'DEPOSIT',
              Amount: '100',
              Currency: 'EUR',
              EconomicClassification: 'INCOME'
            }
          ])
        )
      ).toThrow();
    }
  );
  it('keeps v1/manual input unclassified without interpreting Deposit as capital', () => {
    for (const csv of [
      'Version,Date,Operation,Amount,Currency\n1,2026-10-01,DEPOSIT,100,EUR',
      'Data;Operazione;Importo;Valuta\n2026-10-01;Prelievo;100;EUR'
    ])
      expect(readCashCsv(csv)[0].EconomicClassification).toBe('');
  });
  it('validates civil dates without rolling invalid days forward', () => {
    expect(csvDate('2026-10-25')).toBe('2026-10-25');
    expect(csvDate('1969-12-31')).toBe('1969-12-31');
    expect(csvDate('0001-01-01', true)).toBe('0001-01-01');
    expect(() => csvDate('0000-12-31', true)).toThrow();
    expect(() => csvDate('2026-02-30')).toThrow();
    expect(() => csvDate('2026-10-01T00:00:00Z')).toThrow();
  });
  it.each([
    'NaN',
    'Infinity',
    '1,25',
    '1e3',
    '0.0000000000000000000000000000001'
  ])('rejects non-canonical or rounded amounts %s', (value) => {
    expect(() => decimal(value)).toThrow();
  });
});
