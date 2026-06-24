import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Edit, KeyRound } from 'lucide-react';
import Button from './Button';
import './Table.css';

interface Column<T> {
  header: string;
  accessor: keyof T | ((item: T) => React.ReactNode);
  width?: string;
  className?: string;
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  selectable?: boolean;
  selectedIds?: Set<string | number>;
  onToggleRow?: (id: string | number) => void;
  allSelected?: boolean;
  someSelected?: boolean;
  onToggleAll?: () => void;
  onSelectionChange?: (selectedIds: Set<string | number>) => void;
  getRowClassName?: (item: T) => string;
  loading?: boolean;
  loadingMessage?: string;
  emptyMessage?: string;
  minWidth?: string;
  tableClassName?: string;
}

// Columns that don't all specify a width need content-based sizing, or
// `table-layout: fixed` squashes them evenly regardless of content.
// Tables that size every column explicitly (and pass minWidth) opt into
// fixed layout instead, so their pixel-tuned widths are honored exactly.

const HeaderCheckbox = ({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange?: () => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label="Select visible rows"
    />
  );
};

const Table = <T extends { id: string | number }>({
  columns,
  data,
  selectable = true,
  selectedIds,
  onToggleRow,
  allSelected = false,
  someSelected = false,
  onToggleAll,
  onSelectionChange,
  getRowClassName,
  loading = false,
  loadingMessage = 'Loading...',
  emptyMessage = 'No records found.',
  minWidth,
  tableClassName = '',
}: TableProps<T>) => {
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string | number>>(new Set());
  const isSelectionControlled = selectedIds !== undefined;
  const activeSelectedIds = useMemo(
    () => selectedIds ?? internalSelectedIds,
    [internalSelectedIds, selectedIds],
  );
  const visibleIds = useMemo(() => data.map(item => item.id), [data]);
  const activeAllSelected = isSelectionControlled
    ? allSelected
    : visibleIds.length > 0 && visibleIds.every(id => activeSelectedIds.has(id));
  const activeSomeSelected = isSelectionControlled
    ? someSelected
    : visibleIds.some(id => activeSelectedIds.has(id));
  const colSpan = columns.length + (selectable ? 1 : 0);

  const updateInternalSelection = (next: Set<string | number>) => {
    setInternalSelectedIds(next);
    onSelectionChange?.(next);
  };

  const toggleRow = (id: string | number) => {
    if (isSelectionControlled) {
      onToggleRow?.(id);
      return;
    }

    const next = new Set(activeSelectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    updateInternalSelection(next);
  };

  const toggleAll = () => {
    if (isSelectionControlled) {
      onToggleAll?.();
      return;
    }

    const next = new Set(activeSelectedIds);
    if (activeAllSelected) {
      visibleIds.forEach(id => next.delete(id));
    } else {
      visibleIds.forEach(id => next.add(id));
    }
    updateInternalSelection(next);
  };

  return (
    <div className="table-container">
      <table
        className={`custom-table ${tableClassName}`.trim()}
        style={{ minWidth, tableLayout: minWidth ? 'fixed' : 'auto' }}
      >
        <thead>
          <tr>
            {selectable && (
              <th className="checkbox-column">
                <HeaderCheckbox
                  checked={activeAllSelected}
                  indeterminate={activeSomeSelected && !activeAllSelected}
                  onChange={toggleAll}
                />
              </th>
            )}
            {columns.map((col, index) => (
              <th key={index} className={col.className} style={{ width: col.width }}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={colSpan} className="table-empty-cell">{loadingMessage}</td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="table-empty-cell">{emptyMessage}</td>
            </tr>
          ) : (
            data.map((item) => (
              <tr
                key={item.id}
                className={[
                  activeSelectedIds.has(item.id) ? 'selected-row' : '',
                  getRowClassName?.(item) ?? '',
                ].filter(Boolean).join(' ')}
              >
                {selectable && (
                  <td className="checkbox-column">
                    <input
                      type="checkbox"
                      checked={activeSelectedIds.has(item.id)}
                      onChange={() => toggleRow(item.id)}
                      aria-label={`Select row ${item.id}`}
                    />
                  </td>
                )}
                {columns.map((col, colIndex) => (
                  <td key={colIndex} className={col.className}>
                    {typeof col.accessor === 'function'
                      ? col.accessor(item)
                      : (item[col.accessor] as React.ReactNode)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

export const TableRowActions = ({
  onEdit,
  onUpdatePassword,
}: {
  onEdit: () => void;
  onUpdatePassword: () => void;
}) => (
  <div className="action-buttons">
    <Button variant="outline" size="sm" onClick={onEdit}>
      <Edit size={14} />
      Edit
    </Button>
    <Button variant="outline" size="sm" onClick={onUpdatePassword}>
      <KeyRound size={14} />
      Update password
    </Button>
  </div>
);

export default Table;
