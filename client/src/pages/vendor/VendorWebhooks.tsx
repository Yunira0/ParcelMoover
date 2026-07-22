import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, ListTree, Send, Webhook as WebhookIcon, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Button from '../../components/Button';
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookDeliveries,
  getWebhookEndpoints,
  regenerateWebhookSecret,
  retryWebhookDelivery,
  sendTestWebhookEvent,
  updateWebhookEndpoint,
  type WebhookDelivery,
  type WebhookEndpoint,
} from '../../services/webhooks.service';
import { toBsDateTime } from '../../utils/nepaliDate';
import '../../components/Modal.css';
import './VendorWebhooks.css';

const formatDate = (value: string | null) => (value ? toBsDateTime(value) : '—');

const statusLabel = (endpoint: WebhookEndpoint) => {
  if (endpoint.disabled_at) return 'Disabled (failing)';
  return endpoint.enabled ? 'Active' : 'Paused';
};

const statusClass = (endpoint: WebhookEndpoint) => {
  if (endpoint.disabled_at) return 'disabled';
  return endpoint.enabled ? 'active' : 'paused';
};

const VendorWebhooks: React.FC = () => {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  // Plaintext secret from the last create/regenerate — shown once, cleared when dismissed.
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);

  const [deliveriesFor, setDeliveriesFor] = useState<WebhookEndpoint | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState('');

  const loadEndpoints = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setEndpoints(await getWebhookEndpoints());
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load webhook endpoints.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEndpoints(); }, [loadEndpoints]);

  const openCreate = () => {
    setNewName('');
    setNewUrl('');
    setCreateError('');
    setRevealedSecret(null);
    setCopied(false);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setRevealedSecret(null);
    setCopied(false);
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim() || !newUrl.trim()) {
      setCreateError('Give the endpoint a name and a URL.');
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      const created = await createWebhookEndpoint(newName.trim(), newUrl.trim());
      setRevealedSecret(created.secret);
      await loadEndpoints();
    } catch (err: any) {
      setCreateError(err?.response?.data?.message || 'Failed to create webhook endpoint.');
    } finally {
      setCreating(false);
    }
  };

  const copySecret = async () => {
    if (!revealedSecret) return;
    try {
      await navigator.clipboard.writeText(revealedSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCreateError('Could not copy automatically — select the secret and copy it manually.');
    }
  };

  const handleDelete = async (endpoint: WebhookEndpoint) => {
    const confirmed = window.confirm(
      `Delete "${endpoint.name}"? ParcelMoover will stop sending events to this URL immediately.`,
    );
    if (!confirmed) return;
    setBusyId(endpoint.id);
    setError('');
    try {
      await deleteWebhookEndpoint(endpoint.id);
      await loadEndpoints();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to delete webhook endpoint.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleEnabled = async (endpoint: WebhookEndpoint) => {
    setBusyId(endpoint.id);
    setError('');
    try {
      await updateWebhookEndpoint(endpoint.id, { enabled: !endpoint.enabled });
      await loadEndpoints();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to update webhook endpoint.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRegenerate = async (endpoint: WebhookEndpoint) => {
    const confirmed = window.confirm(
      `Regenerate the secret for "${endpoint.name}"? The old secret stops verifying signatures immediately — update your endpoint before confirming.`,
    );
    if (!confirmed) return;
    setBusyId(endpoint.id);
    setError('');
    try {
      const { secret } = await regenerateWebhookSecret(endpoint.id);
      setRevealedSecret(secret);
      setNewName(endpoint.name);
      setNewUrl(endpoint.url);
      setCreateOpen(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to regenerate secret.');
    } finally {
      setBusyId(null);
    }
  };

  const handleTest = async (endpoint: WebhookEndpoint) => {
    setBusyId(endpoint.id);
    setError('');
    try {
      await sendTestWebhookEvent(endpoint.id);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to send test event.');
    } finally {
      setBusyId(null);
    }
  };

  const openDeliveries = async (endpoint: WebhookEndpoint) => {
    setDeliveriesFor(endpoint);
    setDeliveriesLoading(true);
    setDeliveriesError('');
    try {
      const { data } = await getWebhookDeliveries(endpoint.id);
      setDeliveries(data);
    } catch (err: any) {
      setDeliveriesError(err?.response?.data?.message || 'Failed to load deliveries.');
    } finally {
      setDeliveriesLoading(false);
    }
  };

  const closeDeliveries = () => {
    setDeliveriesFor(null);
    setDeliveries([]);
  };

  const handleRetryDelivery = async (deliveryId: string) => {
    if (!deliveriesFor) return;
    try {
      await retryWebhookDelivery(deliveriesFor.id, deliveryId);
      await openDeliveries(deliveriesFor);
    } catch (err: any) {
      setDeliveriesError(err?.response?.data?.message || 'Failed to retry delivery.');
    }
  };

  const columns = useMemo(
    () => [
      {
        header: 'NAME',
        accessor: (e: WebhookEndpoint) => (
          <span className="webhook-name-cell">
            <WebhookIcon size={14} />
            {e.name}
          </span>
        ),
        width: '200px',
      },
      {
        header: 'URL',
        accessor: (e: WebhookEndpoint) => <code className="webhook-url-cell">{e.url}</code>,
        width: '320px',
      },
      { header: 'CREATED', accessor: (e: WebhookEndpoint) => formatDate(e.created_at), width: '130px' },
      {
        header: 'STATUS',
        accessor: (e: WebhookEndpoint) => (
          <span className={`webhook-status ${statusClass(e)}`}>{statusLabel(e)}</span>
        ),
        width: '140px',
      },
      {
        header: '',
        accessor: (e: WebhookEndpoint) => (
          <div className="webhook-row-actions">
            <button
              type="button"
              className="webhook-action-btn"
              onClick={() => openDeliveries(e)}
              title="View deliveries"
            >
              <ListTree size={14} /> Deliveries
            </button>
            <button
              type="button"
              className="webhook-action-btn"
              onClick={() => handleTest(e)}
              disabled={busyId === e.id}
              title="Send a test event"
            >
              <Send size={14} /> Test
            </button>
            <button
              type="button"
              className="webhook-action-btn"
              onClick={() => handleToggleEnabled(e)}
              disabled={busyId === e.id}
            >
              {e.enabled ? 'Pause' : 'Resume'}
            </button>
            <button
              type="button"
              className="webhook-action-btn"
              onClick={() => handleRegenerate(e)}
              disabled={busyId === e.id}
            >
              Roll secret
            </button>
            <button
              type="button"
              className="webhook-action-btn danger"
              onClick={() => handleDelete(e)}
              disabled={busyId === e.id}
            >
              Delete
            </button>
          </div>
        ),
        width: '360px',
      },
    ],
    [busyId],
  );

  return (
    <div className="webhooks-page">
      <PageHeader
        title="Webhooks"
        subtitle="Get notified the moment an order's status changes — no polling required."
        actionLabel="Add Endpoint"
        actionIcon={<WebhookIcon size={16} />}
        onAction={openCreate}
      />

      {error && <p className="webhooks-error">{error}</p>}

      <Table
        columns={columns}
        data={endpoints}
        selectable={false}
        loading={loading}
        loadingMessage="Loading webhook endpoints..."
        emptyMessage="No webhook endpoints yet. Add one to start receiving order.status_changed events."
        minWidth="1150px"
      />

      <div className="webhooks-docs">
        <h3>Quick start</h3>
        <p>
          We POST a JSON body to your URL on every order status change, signed via the{' '}
          <code>X-ParcelMoover-Signature</code> header (<code>t=&lt;unix_ts&gt;,v1=&lt;hmac_sha256&gt;</code>).
          Verify it with your endpoint secret before trusting the payload.
        </p>
        <ul>
          <li>Currently fires <code>order.status_changed</code> for every tracked order.</li>
          <li>Failed deliveries retry with backoff for up to ~24 hours.</li>
          <li>An endpoint that keeps failing is automatically disabled — resume it once it's fixed.</li>
        </ul>
      </div>

      {createOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h2>{revealedSecret ? 'Your webhook secret' : 'Add webhook endpoint'}</h2>
              <Button variant="ghost" size="icon" className="modal-close-btn" onClick={closeCreate}>
                <X size={18} />
              </Button>
            </div>

            {revealedSecret ? (
              <>
                <p className="modal-desc">
                  Copy this secret now — for security it will never be shown again. Use it to verify the{' '}
                  <code>X-ParcelMoover-Signature</code> header on every delivery.
                </p>
                <div className="webhook-secret-reveal">
                  <code>{revealedSecret}</code>
                  <Button variant="secondary" onClick={copySecret}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                {createError && <p className="webhooks-error">{createError}</p>}
                <div className="modal-footer">
                  <Button variant="primary" onClick={closeCreate}>Done</Button>
                </div>
              </>
            ) : (
              <form onSubmit={handleCreate}>
                <p className="modal-desc">
                  We'll POST an <code>order.status_changed</code> event here whenever one of your orders changes status.
                </p>
                <label className="webhook-field">
                  <span>Name</span>
                  <input
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder="e.g. mystore.com order sync"
                    maxLength={100}
                    autoFocus
                  />
                </label>
                <label className="webhook-field">
                  <span>Endpoint URL</span>
                  <input
                    value={newUrl}
                    onChange={(event) => setNewUrl(event.target.value)}
                    placeholder="https://mystore.com/webhooks/parcelmoover"
                    maxLength={2048}
                  />
                </label>
                {createError && <p className="webhooks-error">{createError}</p>}
                <div className="modal-footer">
                  <Button variant="secondary" type="button" onClick={closeCreate}>Cancel</Button>
                  <Button variant="primary" type="submit" disabled={creating}>
                    {creating ? 'Adding…' : 'Add Endpoint'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {deliveriesFor && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '720px' }}>
            <div className="modal-header">
              <h2>Deliveries — {deliveriesFor.name}</h2>
              <Button variant="ghost" size="icon" className="modal-close-btn" onClick={closeDeliveries}>
                <X size={18} />
              </Button>
            </div>

            {deliveriesError && <p className="webhooks-error">{deliveriesError}</p>}

            {deliveriesLoading ? (
              <p className="modal-desc">Loading…</p>
            ) : deliveries.length === 0 ? (
              <p className="modal-desc">No deliveries yet.</p>
            ) : (
              <div className="webhook-deliveries-list">
                {deliveries.map((d) => (
                  <div key={d.id} className="webhook-delivery-row">
                    <div className="webhook-delivery-main">
                      <span className={`delivery-status ${d.status}`}>{d.status}</span>
                      <span className="delivery-event-type">{d.event_type}</span>
                      <span className="delivery-meta">
                        attempt {d.attempt_count}
                        {d.last_status_code ? ` · HTTP ${d.last_status_code}` : ''}
                      </span>
                      <span className="delivery-meta">{formatDate(d.created_at)}</span>
                    </div>
                    {d.last_error && <p className="delivery-error">{d.last_error}</p>}
                    {d.status === 'failed' && (
                      <button
                        type="button"
                        className="webhook-action-btn"
                        onClick={() => handleRetryDelivery(d.id)}
                      >
                        Retry now
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorWebhooks;
