import React, { useEffect, useMemo, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import SegmentedTabs from '../../components/SegmentedTabs';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import { AddPurchaseBillModal, CancelPurchaseBillModal } from '../../components/finance/PurchaseBillModals';
import { Banner } from '../accounting/ui';
import { money } from '../accounting/format';
import { getVatRegister, type RegisterKind, type RegisterRow, type VatRegister } from '../../services/vatRegister.service';
import {
  REGISTER_LAYOUTS,
  downloadVatRegister,
  downloadVendorSummary,
  registerTotals,
  vendorSummary,
  type VendorSummaryRow,
} from '../../utils/vatRegister';
import { BS_MONTHS, todayBsParts } from '../../utils/nepaliDate';
import { apiErrorMessage } from '../../utils/serverValidation';
import '../accounting/Accounting.css';

// One BS tax period of a VAT register; the Excel follows the IRD form (utils/vatRegister).
const VatRegisterPage: React.FC<{ kind: RegisterKind }> = ({ kind }) => {
  const layout = REGISTER_LAYOUTS[kind];
  const today = todayBsParts();
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.monthIndex + 1);
  const [register, setRegister] = useState<VatRegister | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<RegisterRow | null>(null);
  const [vendorId, setVendorId] = useState('');
  const [view, setView] = useState<'statements' | 'vendors'>('statements');

  useEffect(() => {
    let active = true;
    getVatRegister(kind, year, month)
      .then((data) => { if (active) { setRegister(data); setError(''); } })
      .catch((err) => { if (active) setError(apiErrorMessage(err, 'Could not load the register.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, year, month, reloadKey]);

  const changePeriod = (next: { year?: number; month?: number }) => {
    setLoading(true);
    setVendorId('');
    if (next.year) setYear(next.year);
    if (next.month) setMonth(next.month);
  };
  const reload = () => {
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  const screenColumns = layout.columns.filter((c) => !c.excelOnly);

  // Sales registers can be read per vendor: filtered to one, or summarised by vendor.
  const isSales = kind === 'sales' || kind === 'sales-return';
  const byVendor = isSales && view === 'vendors';
  const summary = useMemo(() => vendorSummary(register?.rows ?? []), [register]);
  const vendor = summary.find((line) => line.id === vendorId);
  const shown = useMemo(() => {
    if (!register || !vendorId) return register;
    const rows = register.rows.filter((row) => (row.partyId ?? row.partyName) === vendorId);
    return { ...register, rows, totals: registerTotals(rows) };
  }, [register, vendorId]);
  const rows = shown?.rows ?? [];

  const download = () => {
    if (!register || !shown) return;
    void (byVendor ? downloadVendorSummary(register, summary) : downloadVatRegister(shown, vendor?.name));
  };

  return (
    <div className="acc-page">
      <PageHeader
        title={layout.title}
        actionLabel="Download Excel"
        actionIcon={<Download size={16} />}
        onAction={download}
        actionDisabled={!register || loading}
      >
        {kind === 'purchase' && (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus size={16} />
            Add purchase bill
          </Button>
        )}
      </PageHeader>

      <div className="acc-toolbar">
        <div className="acc-filters">
          <label>
            <span>YEAR (BS)</span>
            <FormField
              label=""
              type="select"
              value={String(year)}
              onChange={(value) => changePeriod({ year: Number(value) })}
              options={Array.from({ length: 6 }, (_, i) => String(today.year - i)).map((y) => ({ value: y, label: y }))}
            />
          </label>
          <label>
            <span>TAX PERIOD</span>
            <FormField
              label=""
              type="select"
              value={String(month)}
              onChange={(value) => changePeriod({ month: Number(value) })}
              options={BS_MONTHS.map((name, i) => ({ value: String(i + 1), label: `${String(i + 1).padStart(2, '0')} ${name}` }))}
            />
          </label>
          {isSales && !byVendor && (
            <label>
              <span>VENDOR</span>
              <FormField
                label=""
                type="select"
                value={vendorId}
                onChange={setVendorId}
                placeholder="All vendors"
                options={summary.map((line) => ({ value: line.id, label: line.name }))}
              />
            </label>
          )}
        </div>
        {isSales && (
          <SegmentedTabs
            ariaLabel="Register view"
            fullWidth={false}
            value={view}
            onChange={setView}
            options={[{ value: 'statements', label: 'Statements' }, { value: 'vendors', label: 'By vendor' }]}
          />
        )}
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      {byVendor ? (
        <Table
          selectable={false}
          loading={loading}
          loadingMessage="Loading register…"
          data={summary}
          // A vendor's line opens their statements.
          onRowClick={(line) => { setVendorId(line.id); setView('statements'); }}
          columns={[
            { header: 'Vendor', accessor: (line: VendorSummaryRow) => line.name },
            { header: 'PAN', accessor: (line: VendorSummaryRow) => line.pan || '—' },
            { header: 'Statements', className: 'acc-num', accessor: (line: VendorSummaryRow) => line.statements },
            { header: kind === 'sales' ? 'Total sales' : 'Total return', className: 'acc-num', accessor: (line: VendorSummaryRow) => money(line.total) },
            { header: 'Taxable value', className: 'acc-num', accessor: (line: VendorSummaryRow) => money(line.taxable) },
            { header: 'VAT 13%', className: 'acc-num', accessor: (line: VendorSummaryRow) => money(line.vat) },
          ]}
          emptyMessage={`No entries for ${BS_MONTHS[month - 1]} ${year}.`}
          footer={register && (
            <tr>
              <td>Total</td>
              <td />
              <td className="acc-num">{register.rows.length}</td>
              <td className="acc-num">{money(register.totals.total)}</td>
              <td className="acc-num">{money(register.totals.taxable)}</td>
              <td className="acc-num">{money(register.totals.vat)}</td>
            </tr>
          )}
        />
      ) : (
      <Table
        selectable={false}
        loading={loading}
        loadingMessage="Loading register…"
        data={rows}
        columns={[
          ...screenColumns.map((c) => ({
            header: c.screenLabel ?? c.label,
            className: c.money ? 'acc-num' : undefined,
            accessor: (row: RegisterRow) => {
              const value = c.value(row);
              if (c.money) return money(Number(value ?? 0));
              return value === null || value === '' ? '—' : value;
            },
          })),
          ...(kind === 'purchase'
            ? [{
                header: '',
                accessor: (row: RegisterRow) =>
                  row.source === 'bill' ? (
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(row)}>
                      Cancel
                    </Button>
                  ) : null,
              }]
            : []),
        ]}
        emptyMessage={`No entries for ${vendor ? `${vendor.name} in ` : ''}${BS_MONTHS[month - 1]} ${year}.`}
        footer={shown && (
          <tr>
            {screenColumns.map((c, i) => (
              <td key={i} className={c.money ? 'acc-num' : undefined}>
                {i === 0 ? 'Total' : c.money ? money(Number(c.value(shown.totals as RegisterRow))) : ''}
              </td>
            ))}
            {kind === 'purchase' && <td />}
          </tr>
        )}
      />
      )}

      {adding && <AddPurchaseBillModal onClose={() => setAdding(false)} onSaved={reload} />}
      {cancelling && (
        <CancelPurchaseBillModal
          billId={cancelling.id}
          billNo={cancelling.invoiceNo}
          onClose={() => setCancelling(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
};

export default VatRegisterPage;
