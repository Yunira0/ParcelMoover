import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import {
  getAllPickupTimeSlots,
  createPickupTimeSlot,
  updatePickupTimeSlot,
  deletePickupTimeSlot,
  type PickupTimeSlot,
} from '../services/pickupTimeSlots.service';
import './PickupTimeSlots.css';

const toTimeInput = (mins: number) => {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const fromTimeInput = (value: string) => {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
};

interface RowState {
  id: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
  dirty: boolean;
}

const toRow = (slot: PickupTimeSlot): RowState => ({
  id: slot.id,
  startTime: toTimeInput(slot.startMinutes),
  endTime: toTimeInput(slot.endMinutes),
  isActive: slot.isActive,
  dirty: false,
});

const PickupTimeSlots: React.FC = () => {
  const [rows, setRows] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newStart, setNewStart] = useState('09:00');
  const [newEnd, setNewEnd] = useState('12:00');
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getAllPickupTimeSlots();
      if (res?.success) setRows(res.data.map(toRow));
    } catch {
      setError('Failed to load pickup time slots.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updateRow = (id: string, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch, dirty: true } : r)));
  };

  const saveRow = async (row: RowState) => {
    setSavingId(row.id);
    setError('');
    try {
      const res = await updatePickupTimeSlot(row.id, {
        startMinutes: fromTimeInput(row.startTime),
        endMinutes: fromTimeInput(row.endTime),
        isActive: row.isActive,
      });
      if (res?.success) {
        setRows((prev) => prev.map((r) => (r.id === row.id ? toRow(res.data) : r)));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save that slot.');
    } finally {
      setSavingId(null);
    }
  };

  const removeRow = async (id: string) => {
    if (!window.confirm('Delete this pickup time slot?')) return;
    setSavingId(id);
    setError('');
    try {
      await deletePickupTimeSlot(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete that slot.');
    } finally {
      setSavingId(null);
    }
  };

  const addSlot = async () => {
    setAdding(true);
    setError('');
    try {
      const res = await createPickupTimeSlot({
        startMinutes: fromTimeInput(newStart),
        endMinutes: fromTimeInput(newEnd),
      });
      if (res?.success) {
        setRows((prev) => [...prev, toRow(res.data)]);
        setNewStart('09:00');
        setNewEnd('12:00');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to add that slot.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="pickup-slots-page">
      <PageHeader
        title="Pickup Time Slots"
        subtitle="Slots vendors can choose from when raising a pickup ticket. Each slot closes 1 hour before it ends; toggle a slot off instead of deleting it if it's only temporary."
      />

      {error && <p className="pickup-slots-error">{error}</p>}

      {loading ? (
        <p className="pickup-slots-muted">Loading pickup time slots…</p>
      ) : (
        <div className="pickup-slots-card">
          <table className="pickup-slots-table">
            <thead>
              <tr>
                <th>Start</th>
                <th>End</th>
                <th>Active</th>
                <th aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="time"
                      value={row.startTime}
                      onChange={(e) => updateRow(row.id, { startTime: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="time"
                      value={row.endTime}
                      onChange={(e) => updateRow(row.id, { endTime: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={(e) => updateRow(row.id, { isActive: e.target.checked })}
                    />
                  </td>
                  <td className="pickup-slots-row-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!row.dirty || savingId === row.id}
                      onClick={() => saveRow(row)}
                    >
                      {savingId === row.id ? 'Saving…' : 'Save'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={savingId === row.id}
                      onClick={() => removeRow(row.id)}
                      aria-label="Delete slot"
                    >
                      <Trash2 size={16} />
                    </Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="pickup-slots-muted">No time slots yet.</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="pickup-slots-add-row">
            <input type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
            <span className="pickup-slots-add-sep">to</span>
            <input type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
            <Button variant="primary" size="sm" onClick={addSlot} disabled={adding}>
              <Plus size={14} /> {adding ? 'Adding…' : 'Add slot'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PickupTimeSlots;
