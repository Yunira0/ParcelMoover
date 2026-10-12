import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import { getVendorBankTransfers, type BankTransferRow } from '../../services/finance.service';
import { formatAmount } from '../../utils/format';
import { downloadExcel } from '../../utils/excel';
import { useBackOr } from '../../hooks/useBackOr';
import { hasAdminPermission } from '../../utils/auth';
import { printAction, quitAction } from '../../components/finance/tallyKeys';
import '../../components/finance/tally.css';
import './BankTransferPage.css';

/**
 * Bank Transfer — every vendor statement the office still owes, laid out as
 * the connectIPS (CIPS) bulk transfer sheet the bank accepts: COD amount, the
 * bank charge taken off it, the net payable that is actually sent, and the
 * creditor's bank code, account and remark.
 *
 * The page only prepares the file. Uploading it to connectIPS, and recording
 * each statement as paid afterwards (Vendor COD > COD & Settlements), stay
 * separate steps, so nothing here moves money or changes a statement.
 */

/** connectIPS's usual flat fee per transfer; editable on the page. */
const DEFAULT_BANK_CHARGE = 10;
/** connectIPS accepts at most this many transfers per uploaded sheet. */
const CIPS_MAX_ROWS = 1000;
/** Column limits from the bank's template header. */
const CIPS_ACCOUNT_MAX = 20;
const CIPS_NAME_MAX = 140;
const CIPS_REMARK_MAX = 30;

/** Remarks 1 / end-to-end id: "COD - <vendor>", cut to the bank's 30 characters. */
const remarkFor = (row: BankTransferRow) => `COD - ${row.vendorName}`.slice(0, CIPS_REMARK_MAX).trim();

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A statement with the bank charge applied. */
interface TransferLine extends BankTransferRow {
  bankCharge: number;
  netPayable: number;
  remark: string;
  problems: string[];
}

/** Why a row can't go in the bank sheet yet. Empty means it's ready. */
function problemsOf(row: BankTransferRow, netPayable: number): string[] {
  const problems: string[] = [];
  // The code comes from the bank list; a bank typed by hand before the list existed has none.
  if (!row.bankCode) problems.push(row.bankName ? 'Bank not on the bank list - pick it again' : 'No bank');
  else if (!/^\d{1,4}$/.test(row.bankCode)) problems.push('Bank code must be up to 4 digits');
  if (!row.accountNumber) problems.push('No account number');
  else if (row.accountNumber.length > CIPS_ACCOUNT_MAX) problems.push(`Account number over ${CIPS_ACCOUNT_MAX} characters`);
  if (!row.accountName) problems.push('No account name');
  else if (row.accountName.length > CIPS_NAME_MAX) problems.push(`Account name over ${CIPS_NAME_MAX} characters`);
  if (netPayable <= 0) problems.push("Owed amount doesn't cover the bank charge");
  return problems;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Writes the sheet in the bank's own layout - the three notice lines, the
 * header on row 4, transfers from row 5 - because connectIPS rejects a file
 * whose format was changed. Codes and account numbers are text cells so a
 * leading zero survives.
 */
async function downloadCipsSheet(lines: TransferLine[]): Promise<void> {
  try {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('CIPS BULK TRANSFER');
    ws.addRow(['*Allowed transaction count is 1000. Click here to check bank codes.']);
    ws.addRow(['Note: Do not change the file format. (*) denotes required fields. ']);
    ws.addRow(['CIPS BULK TRANSACTION (Supports only other bank)']);
    const header = ws.addRow([
      'Transaction Amount (*)',
      'Creditor Bank Code (Max 4 Digits*)',
      'Creditor Account Number (Max 20 Characters*)',
      'Creditor Account Name (Max 140 Characters*)',
      'Remarks 1/End to end Id (Max 30 Characters*)',
      'Remarks 2',
    ]);
    header.font = { bold: true };
    for (const line of lines) {
      ws.addRow([line.netPayable, line.bankCode, line.accountNumber, line.accountName, line.remark, line.statementId]);
    }
    ws.getColumn(1).numFmt = '0.00';
    ws.getColumn(2).numFmt = '@';
    ws.getColumn(3).numFmt = '@';
    [24, 32, 43, 43, 43, 18].forEach((width, i) => { ws.getColumn(i + 1).width = width; });

    const buffer = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `cips-bulk-transfer-${today()}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    console.error('CIPS sheet download failed:', error);
    window.alert('Could not download the bank sheet. Check your connection and try again.');
  }
}

const BankTransferPage: React.FC = () => {
  const navigate = useNavigate();
  const goBack = useBackOr('/accounting');
  // An accountant can't open the vendor form, so they get the problem without the link.
  const canEditVendors = hasAdminPermission('MANAGE_USERS');
  const [rows, setRows] = useState<BankTransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const [chargeInput, setChargeInput] = useState(String(DEFAULT_BANK_CHARGE));
  // Rows the user has unticked. Tracking the exclusions (rather than the
  // inclusions) keeps a row ticked when a charge change makes it ready again.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const charge = Number(chargeInput);
  const chargeValid = chargeInput.trim() !== '' && Number.isFinite(charge) && charge >= 0;
  const bankCharge = chargeValid ? round2(charge) : DEFAULT_BANK_CHARGE;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await getVendorBankTransfers());
      setExcluded(new Set());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const lines = useMemo<TransferLine[]>(() => rows.map((row) => {
    const netPayable = round2(row.codAmount - bankCharge);
    return { ...row, bankCharge, netPayable, remark: remarkFor(row), problems: problemsOf(row, netPayable) };
  }), [rows, bankCharge]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return lines;
    return lines.filter((line) =>
      line.vendorName.toLowerCase().includes(term) || line.statementId.toLowerCase().includes(term));
  }, [lines, search]);

  const ready = lines.filter((line) => line.problems.length === 0);
  const blockedCount = lines.length - ready.length;
  const chosen = ready.filter((line) => !excluded.has(line.settlementId));
  const visibleReady = visible.filter((line) => line.problems.length === 0);
  const allVisibleChosen = visibleReady.length > 0 && visibleReady.every((line) => !excluded.has(line.settlementId));

  const totals = chosen.reduce(
    (sum, line) => ({ cod: sum.cod + line.codAmount, charge: sum.charge + line.bankCharge, net: sum.net + line.netPayable }),
    { cod: 0, charge: 0, net: 0 },
  );
  const overLimit = chosen.length > CIPS_MAX_ROWS;

  const toggle = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setExcluded((prev) => {
      const next = new Set(prev);
      visibleReady.forEach((line) => (allVisibleChosen ? next.add(line.settlementId) : next.delete(line.settlementId)));
      return next;
    });
  };

  const exportWorkingSheet = async () => {
    await downloadExcel(
      `vendor-bank-transfers-${today()}`,
      'Bank Transfers',
      [
        'COD Amount', 'Bank Charge', 'Net Payable', 'Creditor Bank Code', 'Creditor Account Number',
        'Creditor Account Name', 'Remarks', 'Statement', 'Ready',
      ],
      lines.map((line) => [
        line.codAmount,
        line.bankCharge,
        line.netPayable,
        line.bankCode,
        line.accountNumber,
        line.accountName,
        line.remark,
        line.statementId,
        line.problems.length === 0 ? 'Yes' : line.problems.join('; '),
      ]),
    );
  };

  const actions: TallyAction[] = [
    {
      key: 'Alt+E',
      label: `CIPS Sheet (${chosen.length})`,
      onSelect: () => void downloadCipsSheet(chosen),
      disabled: chosen.length === 0 || overLimit || !chargeValid,
      primary: true,
    },
    { key: 'Alt+W', label: 'Working Sheet', onSelect: () => void exportWorkingSheet(), disabled: lines.length === 0 || !chargeValid },
    { key: 'Alt+R', label: 'Refresh', onSelect: () => void load() },
    printAction(),
    quitAction(goBack),
  ];

  const filters = (
    <>
      <label className="bt-charge">
        <span>Bank charge (Rs)</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={chargeInput}
          onChange={(event) => setChargeInput(event.target.value)}
          aria-invalid={!chargeValid}
          aria-describedby={chargeValid ? undefined : 'bt-charge-error'}
        />
      </label>
      <label>
        <span>Vendor or statement</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search"
        />
      </label>
      {!chargeValid && (
        <span id="bt-charge-error" className="bt-field-error" role="alert">
          Enter a bank charge of 0 or more.
        </span>
      )}
    </>
  );

  return (
    <TallyPage
      title="Bank Transfer"
      period={`${lines.length} unpaid ${lines.length === 1 ? 'statement' : 'statements'}`}
      periodLabel="Vendor COD"
      actions={actions}
      filters={filters}
      error={error}
      loading={loading}
      menu
    >
      <div className="tly-voucher jv bt">
        <div className="jv-meta">
          <div className="jv-meta-field">
            <span>Bank charge :</span>
            <strong>Rs {formatAmount(bankCharge)} per transfer</strong>
          </div>
          <div className="jv-meta-field">
            <span>In sheet :</span>
            <strong>{chosen.length} of {ready.length}</strong>
          </div>
          <div className="jv-meta-field jv-meta-no">
            <span>Sending :</span>
            <strong className="bt-num">Rs {formatAmount(totals.net)}</strong>
          </div>
        </div>

        {blockedCount > 0 && (
          <p className="tly-note tly-note-danger bt-note">
            {blockedCount === 1 ? '1 statement is' : `${blockedCount} statements are`} left out of the bank sheet:
            the reason is under its remark.{' '}
            {canEditVendors
              ? <>Use <strong>Fix</strong> to open the vendor and pick the bank from the list or add the account.</>
              : 'Ask an admin to fix the bank details on the vendor.'}
          </p>
        )}
        {overLimit && (
          <p className="tly-note tly-note-danger bt-note">
            connectIPS takes at most {CIPS_MAX_ROWS} transfers per sheet. Untick {chosen.length - CIPS_MAX_ROWS} and
            send the rest in a second sheet.
          </p>
        )}

        <div className="tly-scroll">
          <table className="tly-sheet jv-sheet jv-report bt-sheet">
            <thead>
              <tr>
                <th className="bt-check">
                  <input
                    type="checkbox"
                    checked={allVisibleChosen}
                    disabled={visibleReady.length === 0}
                    onChange={toggleAllVisible}
                    aria-label="Include every ready statement shown"
                  />
                </th>
                <th className="tly-amt">COD Amount</th>
                <th className="tly-amt">Bank Charge</th>
                <th className="tly-amt">Net Payable</th>
                <th>Creditor Bank Code</th>
                <th>Creditor Account Number</th>
                <th>Creditor Account Name</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((line) => {
                const isReady = line.problems.length === 0;
                const isChosen = isReady && !excluded.has(line.settlementId);
                return (
                  <tr
                    key={line.settlementId}
                    className={`bt-row${isReady ? '' : ' bt-row-blocked'}${isChosen ? ' bt-row-chosen' : ''}`}
                  >
                    <td className="bt-check">
                      <input
                        type="checkbox"
                        checked={isChosen}
                        disabled={!isReady}
                        onChange={() => toggle(line.settlementId)}
                        aria-label={`Include ${line.vendorName} ${line.statementId} in the bank sheet`}
                      />
                    </td>
                    <td className="tly-amt">{formatAmount(line.codAmount)}</td>
                    <td className="tly-amt tly-muted">− {formatAmount(line.bankCharge)}</td>
                    <td className={`tly-amt bt-net${line.netPayable <= 0 ? ' tly-neg' : ''}`}>
                      {formatAmount(line.netPayable)}
                    </td>
                    <td className="bt-num">
                      {line.bankCode || <span className="bt-missing">—</span>}
                      {line.bankName && <div className="tly-muted bt-sub">{line.bankName}</div>}
                    </td>
                    <td className="bt-num">{line.accountNumber || <span className="bt-missing">—</span>}</td>
                    <td>{line.accountName || <span className="bt-missing">—</span>}</td>
                    <td>
                      <div className="bt-remark" title={`COD - ${line.vendorName}`}>{line.remark}</div>
                      <Link to={`/finance/settlements/${line.settlementId}`} className="bt-statement bt-sub">
                        {line.statementId}
                      </Link>
                      {line.status === 'partially_paid' && <span className="tly-muted bt-sub"> · part paid</span>}
                      {!isReady && (
                        <div className="bt-problem">
                          {line.problems.join(' · ')}
                          {canEditVendors && (
                            <>
                              {' '}
                              <Link to={`/vendors/${line.vendorId}/edit`} className="bt-fix">Fix</Link>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && lines.length === 0 && (
                <tr className="jv-empty">
                  <td colSpan={8}>
                    No vendor is owed anything right now. Statements appear here once they're created under
                    Vendor COD and stay until they're paid.
                  </td>
                </tr>
              )}
              {!loading && lines.length > 0 && visible.length === 0 && (
                <tr className="jv-empty">
                  <td colSpan={8}>No statement matches "{search}".</td>
                </tr>
              )}
            </tbody>
            {chosen.length > 0 && (
              <tfoot>
                <tr className="jv-foot-total jv-foot-closing">
                  <td />
                  <td className="tly-amt">{formatAmount(totals.cod)}</td>
                  <td className="tly-amt">− {formatAmount(totals.charge)}</td>
                  <td className="tly-amt">{formatAmount(totals.net)}</td>
                  <td colSpan={4} className="bt-foot-count">
                    Total · {chosen.length} {chosen.length === 1 ? 'transfer' : 'transfers'}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <p className="tly-muted bt-after">
          After the bank confirms the transfers, record each statement as paid from{' '}
          <button type="button" className="bt-link" onClick={() => navigate('/accounting/transactions/vendor-cod')}>
            Vendor COD › COD &amp; Settlements
          </button>
          . This page doesn't mark anything paid.
        </p>
      </div>
    </TallyPage>
  );
};

export default BankTransferPage;
