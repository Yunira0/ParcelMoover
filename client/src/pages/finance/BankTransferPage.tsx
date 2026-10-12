import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import StatusChip from '../../components/StatusChip';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import { Banner } from '../accounting/ui';
import { money } from '../accounting/format';
import { getVendorBankTransfers, type BankTransferRow } from '../../services/finance.service';
import { downloadExcel } from '../../utils/excel';
import { hasAdminPermission } from '../../utils/auth';
import { settlementStatusLabel, settlementStatusTone } from '../../utils/settlementStatus';
import '../accounting/Accounting.css';
import './BankTransferPage.css';

/**
 * COD Transfer Report — every pending or part-paid vendor statement, with the
 * vendor's bank details and what the connectIPS (CIPS) bulk transfer will send:
 * the amount still owed, the bank charge taken off it, and the net payable.
 *
 * The page only prepares the bank file. Uploading it to connectIPS, and
 * recording each statement as paid afterwards (Vendor COD > COD & Settlements),
 * stay separate steps, so nothing here moves money or changes a statement.
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

/** A statement with the bank charge applied, shaped for <Table>. */
interface TransferLine extends BankTransferRow {
  id: string;
  bankCharge: number;
  netPayable: number;
  remark: string;
  problems: string[];
}

/** Why a row can't go in the bank sheet yet. Empty means it's ready. */
function problemsOf(row: BankTransferRow, netPayable: number): string[] {
  const problems: string[] = [];
  // The code comes from the bank list; a bank typed by hand before the list existed has none.
  if (!row.bankCode) problems.push(row.bankName ? 'Bank not on the bank list' : 'No bank');
  else if (!/^\d{1,4}$/.test(row.bankCode)) problems.push('Bank code must be up to 4 digits');
  if (!row.accountNumber) problems.push('No account number');
  else if (row.accountNumber.length > CIPS_ACCOUNT_MAX) problems.push(`Account number over ${CIPS_ACCOUNT_MAX} characters`);
  if (!row.accountName) problems.push('No account name');
  else if (row.accountName.length > CIPS_NAME_MAX) problems.push(`Account name over ${CIPS_NAME_MAX} characters`);
  if (netPayable <= 0) problems.push("Owed amount doesn't cover the bank charge");
  return problems;
}

const today = () => new Date().toISOString().slice(0, 10);

function errorText(error: unknown): string {
  const response = (error as { response?: { data?: { message?: string } } }).response;
  return response?.data?.message ?? (error as Error).message ?? 'Could not load the report.';
}

/**
 * Writes the connectIPS bulk transfer sheet: the bank's column header on row 1,
 * transfers from row 2. Codes and account numbers are text cells so a leading
 * zero survives.
 */
async function downloadCipsSheet(lines: TransferLine[]): Promise<void> {
  try {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('CIPS BULK TRANSFER');
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

const missing = (text = 'Missing') => <span className="bt-problem">{text}</span>;

const BankTransferPage: React.FC = () => {
  // An accountant can't open the vendor form, so they get the problem without the link.
  const canEditVendors = hasAdminPermission('MANAGE_USERS');
  const [rows, setRows] = useState<BankTransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chargeInput, setChargeInput] = useState(String(DEFAULT_BANK_CHARGE));
  // Rows the user has unticked. Tracking the exclusions (rather than the
  // inclusions) keeps a row ticked when a charge change makes it ready again.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const charge = Number(chargeInput);
  const chargeValid = chargeInput.trim() !== '' && Number.isFinite(charge) && charge >= 0;
  const bankCharge = chargeValid ? round2(charge) : DEFAULT_BANK_CHARGE;

  useEffect(() => {
    let cancelled = false;
    getVendorBankTransfers()
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setExcluded(new Set());
      })
      .catch((err) => { if (!cancelled) setError(errorText(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const lines = useMemo<TransferLine[]>(() => rows.map((row) => {
    const netPayable = round2(row.codAmount - bankCharge);
    return {
      ...row,
      id: row.settlementId,
      bankCharge,
      netPayable,
      remark: remarkFor(row),
      problems: problemsOf(row, netPayable),
    };
  }), [rows, bankCharge]);

  const isReady = (line: TransferLine) => line.problems.length === 0;
  const ready = lines.filter(isReady);
  const chosen = ready.filter((line) => !excluded.has(line.id));
  const chosenIds = new Set<string | number>(chosen.map((line) => line.id));
  const allChosen = ready.length > 0 && chosen.length === ready.length;

  const owed = lines.reduce((sum, line) => sum + line.codAmount, 0);
  const overLimit = chosen.length > CIPS_MAX_ROWS;

  const toggle = (id: string | number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setExcluded((prev) => {
      const next = new Set(prev);
      ready.forEach((line) => (allChosen ? next.add(line.id) : next.delete(line.id)));
      return next;
    });
  };

  const exportReport = async () => {
    await downloadExcel(
      `cod-transfer-report-${today()}`,
      'COD Transfer Report',
      [
        'COD Amount', 'Bank Charge', 'Net Payable', 'Vendor Bank Code', 'Vendor Account Name',
        'Vendor Account Number', 'Remarks', 'Status',
      ],
      lines.map((line) => [
        line.codAmount,
        line.bankCharge,
        line.netPayable,
        line.bankCode ?? '',
        line.accountName ?? '',
        line.accountNumber ?? '',
        line.remark,
        settlementStatusLabel(line.status),
      ]),
    );
  };

  return (
    <div className="acc-page">
      <PageHeader
        title="COD Transfer Report"
        subtitle={loading
          ? 'Pending vendor settlements'
          : `${lines.length} pending ${lines.length === 1 ? 'settlement' : 'settlements'} · ${money(owed)} owed`}
        actionLabel={`CIPS sheet (${chosen.length})`}
        actionIcon={<Download size={16} />}
        onAction={() => void downloadCipsSheet(chosen)}
        actionDisabled={chosen.length === 0 || overLimit || !chargeValid}
      >
        <Button variant="outline" onClick={() => void exportReport()} disabled={lines.length === 0 || !chargeValid}>
          <Download size={16} />
          Export
        </Button>
      </PageHeader>

      <div className="acc-toolbar">
        <label className="bt-charge">
          <span>BANK CHARGE (RS)</span>
          <FormField
            label=""
            type="decimal"
            min={0}
            step="any"
            value={chargeInput}
            onChange={setChargeInput}
            error={chargeValid ? undefined : 'Enter 0 or more.'}
          />
        </label>
      </div>

      {error && <Banner tone="danger">{error}</Banner>}
      {overLimit && (
        <Banner tone="danger">
          connectIPS takes at most {CIPS_MAX_ROWS} transfers per sheet. Untick {chosen.length - CIPS_MAX_ROWS} and
          send the rest in a second sheet.
        </Banner>
      )}

      <Table
        selectable
        selectedIds={chosenIds}
        onToggleRow={toggle}
        allSelected={allChosen}
        someSelected={chosen.length > 0 && !allChosen}
        onToggleAll={toggleAll}
        isRowSelectable={isReady}
        getRowClassName={(line) => (isReady(line) ? '' : 'bt-row-blocked')}
        loading={loading}
        loadingMessage="Loading pending settlements…"
        data={lines}
        columns={[
          { header: 'COD amount', className: 'acc-num', accessor: (line) => money(line.codAmount) },
          { header: 'Bank charge', className: 'acc-num', accessor: (line) => money(line.bankCharge) },
          {
            header: 'Net payable',
            className: 'acc-num',
            accessor: (line) => (line.netPayable > 0 ? money(line.netPayable) : missing(money(line.netPayable))),
          },
          {
            header: 'Vendor bank code',
            accessor: (line) => {
              if (line.bankCode && /^\d{1,4}$/.test(line.bankCode)) return line.bankCode;
              return (
                <>
                  {missing(line.bankName ? 'Not on bank list' : 'Missing')}
                  {line.bankName && <span className="acc-sub">{line.bankName}</span>}
                </>
              );
            },
          },
          {
            header: 'Vendor account name',
            accessor: (line) => line.accountName || missing(),
          },
          {
            header: 'Vendor account number',
            accessor: (line) => line.accountNumber || missing(),
          },
          {
            header: 'Remarks',
            accessor: (line) => (
              <>
                {line.remark}
                {!isReady(line) && canEditVendors && (
                  <Link to={`/vendors/${line.vendorId}/edit`} className="acc-sub bt-fix">Fix vendor</Link>
                )}
              </>
            ),
          },
          {
            header: 'Status',
            accessor: (line) => (
              <StatusChip variant="solid" tone={settlementStatusTone(line.status)}>
                {settlementStatusLabel(line.status)}
              </StatusChip>
            ),
          },
        ]}
        emptyMessage="No pending vendor settlements."
      />
    </div>
  );
};

export default BankTransferPage;
